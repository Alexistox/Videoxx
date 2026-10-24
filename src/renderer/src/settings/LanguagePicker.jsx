import { useMemo } from "react";
import { Picker } from "../components/Picker";
import { LANGUAGES, cantDrawWhy, lang, languageGroup, styleDraws } from "./languages";

export const LangMark = ({ code }) => (
  <span className="lg-mark" aria-hidden="true">
    {lang(code).code.toUpperCase()}
  </span>
);
function languageOptions(base) {
  return LANGUAGES.map((l) => {
    const off = !!base && !styleDraws(base, l.code);
    return {
      value: l.code,
      label: l.name,
      icon: <LangMark code={l.code} />,
      keywords: `${l.native} ${l.code}`,
      group: languageGroup(l),
      // (one line in the menu: "Not in this style: its fonts have no ł, ą or ż" wrapped, leaving "or ż" alone)
      hint: off ? `This style's ${cantDrawWhy(base, l.code).replace(/^its /, "")}` : l.native !== l.name ? l.native : void 0,
      disabled: off,
    };
  });
}
export function LanguagePicker({
  id,
  value,
  onChange,
  base,
  ariaLabel = "Language",
  menuWidth = 320,
  className,
  trigger,
  typeAhead,
  disabled,
}) {
  const opts = useMemo(() => languageOptions(base), [base]);
  return (
    <Picker
      id={id}
      value={value}
      options={opts}
      onChange={onChange}
      ariaLabel={ariaLabel}
      menuWidth={menuWidth}
      search
      className={className}
      trigger={trigger}
      typeAhead={typeAhead}
      searchGroups={false}
      searchHints={false}
      disabled={disabled}
    />
  );
}
