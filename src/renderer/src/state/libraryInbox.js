let inbox = false;
export const requestLibraryInbox = () => {
  inbox = true;
};
export const takeLibraryInbox = () => {
  const v = inbox;
  inbox = false;
  return v;
};
