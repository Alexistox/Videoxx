import zlib from "node:zlib";
import { LIMITS, unsafeName } from "../studio/staticCheck";

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 3988292384 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  if (typeof zlib.crc32 === "function") return zlib.crc32(buf) >>> 0;
  let c = 4294967295;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 4294967295) >>> 0;
}
const refuse = (msg) => {
  const e = new Error(msg);
  e.code = "CZ_ZIP_REFUSED";
  return e;
};
const size = (n) => (n >= 1048576 ? `${+(n / 1048576).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);
export function readZip(buf, limits = {}) {
  const L = { ...LIMITS, ...limits };
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
  if (buf.length < 22) throw refuse("This is not a zip file (too short).");
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--)
    if (buf.readUInt32LE(i) === 101010256) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw refuse("This is not a zip file (no end-of-archive record).");
  if (eocd >= 20 && buf.readUInt32LE(eocd - 20) === 117853008)
    throw refuse(
      "This zip uses the zip64 format, which the kit does not read. Package the style with `cz package` (or zip the folder with a tool that writes a plain zip).",
    );
  const count = buf.readUInt16LE(eocd + 10),
    cdSize = buf.readUInt32LE(eocd + 12),
    cdOff = buf.readUInt32LE(eocd + 16);
  if (count === 65535 || cdOff === 4294967295 || cdSize === 4294967295)
    throw refuse("This zip uses the zip64 format, which the kit does not read. Package the style with `cz package`.");
  if (buf.readUInt16LE(eocd + 4) !== 0 || buf.readUInt16LE(eocd + 6) !== 0)
    throw refuse("This zip is split over several files; use one zip file.");
  if (count > L.files) throw refuse(`The zip holds ${count} entries; a style package may hold at most ${L.files} files.`);
  if (cdOff + cdSize > eocd) throw refuse("This zip is damaged (its directory points past its end).");
  const entries = [],
    seen = new Set();
  let p = cdOff,
    total = 0;
  for (let k = 0; k < count; k++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 33639248) throw refuse("This zip is damaged (a bad directory entry).");
    const madeBy = buf.readUInt16LE(p + 4),
      flags = buf.readUInt16LE(p + 8),
      method = buf.readUInt16LE(p + 10),
      crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20),
      usize = buf.readUInt32LE(p + 24),
      nlen = buf.readUInt16LE(p + 28),
      xlen = buf.readUInt16LE(p + 30),
      clen = buf.readUInt16LE(p + 32);
    const ext = buf.readUInt32LE(p + 38),
      loc = buf.readUInt32LE(p + 42);
    const nameBuf = buf.subarray(p + 46, p + 46 + nlen);
    let name;
    try {
      name = new TextDecoder("utf-8", { fatal: true }).decode(nameBuf);
    } catch {
      name = nameBuf.toString("latin1");
    }
    p += 46 + nlen + xlen + clen;
    if (csize === 4294967295 || usize === 4294967295 || loc === 4294967295)
      throw refuse("This zip uses the zip64 format, which the kit does not read. Package the style with `cz package`.");
    const shown = JSON.stringify(name.slice(0, 120));
    const bad = unsafeName(name.replace(/\/$/, "") || "?");
    if (bad)
      throw refuse(
        `The zip entry ${shown} is refused: ${bad}.${/backslash/.test(bad) ? " (Some zip tools write Windows folder separators: make the package with `cz package`.)" : ""}`,
      );
    const unixMode = madeBy >> 8 === 3 ? (ext >>> 16) & 61440 : 0;
    if (unixMode === 40960) throw refuse(`The zip entry ${shown} is a symbolic link; a package holds only plain files.`);
    if (flags & 1) throw refuse(`The zip entry ${shown} is encrypted; packages are never password-protected.`);
    if (name.endsWith("/") || unixMode === 16384 || (madeBy >> 8 === 0 && ext & 16)) continue;
    if (method !== 0 && method !== 8)
      throw refuse(`The zip entry ${shown} uses compression method ${method}; only stored and deflate are read.`);
    if (usize > L.fileBytes) throw refuse(`${name} is ${size(usize)} unpacked; one file may be at most ${size(L.fileBytes)}.`);
    total += usize;
    if (total > L.totalBytes) throw refuse(`The package is over ${size(L.totalBytes)} unpacked.`);
    const key2 = name.toLowerCase().normalize("NFC");
    if (seen.has(key2)) throw refuse(`The zip holds ${shown} twice (names differ only in case): one would overwrite the other.`);
    seen.add(key2);
    entries.push({ name, method, crc, csize, usize, loc });
  }
  return entries.map((e) => {
    if (e.loc + 30 > buf.length || buf.readUInt32LE(e.loc) !== 67324752) throw refuse(`The zip is damaged at ${e.name}.`);
    const start = e.loc + 30 + buf.readUInt16LE(e.loc + 26) + buf.readUInt16LE(e.loc + 28);
    if (start + e.csize > buf.length) throw refuse(`The zip is damaged at ${e.name} (it ends early).`);
    const raw = buf.subarray(start, start + e.csize);
    let data;
    if (e.method === 0) data = Buffer.from(raw);
    else {
      try {
        data = zlib.inflateRawSync(raw, { maxOutputLength: Math.max(1, e.usize) + 1 });
      } catch (err) {
        throw refuse(`${e.name} could not be unpacked (${String(err.message).slice(0, 80)}).`);
      }
    }
    if (data.length !== e.usize) throw refuse(`${e.name} unpacks to a different size than the zip says (damaged or tampered).`);
    if (crc32(data) !== e.crc) throw refuse(`${e.name} is damaged (its checksum does not match).`);
    return { name: e.name, data };
  });
}
const dosTime = (d) => ({
  time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
  date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
});
export function writeZip(files, opts = {}) {
  const { time, date } = dosTime(opts.date ?? new Date()),
    parts = [],
    central = [];
  let off = 0;
  for (const f of files) {
    const name = String(f.name).replace(/\\/g, "/"),
      bad = unsafeName(name);
    if (bad) throw new Error(`Cannot zip ${JSON.stringify(name)}: ${bad}.`);
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data),
      nameBuf = Buffer.from(name, "utf8");
    const def = zlib.deflateRawSync(data, { level: 9 }),
      stored = def.length >= data.length,
      body = stored ? data : def,
      crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(67324752, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(2048, 6);
    lh.writeUInt16LE(stored ? 0 : 8, 8);
    lh.writeUInt16LE(time, 10);
    lh.writeUInt16LE(date, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(33639248, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(2048, 8);
    ch.writeUInt16LE(stored ? 0 : 8, 10);
    ch.writeUInt16LE(time, 12);
    ch.writeUInt16LE(date, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(0, 38);
    ch.writeUInt32LE(off, 42);
    parts.push(lh, nameBuf, body);
    central.push(ch, nameBuf);
    off += 30 + nameBuf.length + body.length;
    if (off > 4294967280) throw new Error("The package is too big for a plain zip (over 4 GB).");
  }
  if (files.length > 65534) throw new Error("Too many files for a plain zip.");
  const cd = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(101010256, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, end]);
}
