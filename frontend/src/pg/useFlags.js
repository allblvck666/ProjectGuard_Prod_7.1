// frontend/src/pg/useFlags.js
import { useEffect, useState } from "react";
import { getFlags, isNew, onFlagsChange } from "./flags";

// Подписка на флаги: экран перерисовывается сразу после window.__pgFlags().set(...)
export function useFlags() {
  const [flags, setFlags] = useState(getFlags);

  useEffect(() => onFlagsChange(() => setFlags(getFlags())), []);

  return flags;
}

export function useNewUi(name) {
  const flags = useFlags();
  return flags[name] === "new" || flags[name] === "on";
}

export { isNew };
