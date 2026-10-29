import { useEffect, useState } from "react";

/** useState that survives reloads via localStorage. Settings stay on the user's machine. */
export function usePersisted<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(`os.${key}`);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    localStorage.setItem(`os.${key}`, JSON.stringify(value));
  }, [key, value]);
  return [value, setValue] as const;
}
