import { createContext, useContext } from "react";

interface Favs {
  isFav: (symbol: string) => boolean;
  toggle: (symbol: string) => void;
}

/** Favourites = the watchlist. One tap on ☆ next to any coin adds or removes it. */
export const FavoritesContext = createContext<Favs>({ isFav: () => false, toggle: () => {} });

export function FavStar({ symbol, big }: { symbol: string; big?: boolean }) {
  const { isFav, toggle } = useContext(FavoritesContext);
  const on = isFav(symbol);
  return (
    <span
      role="button"
      tabIndex={0}
      className={`fav ${on ? "on" : ""} ${big ? "big" : ""}`}
      title={on ? "Remove from favourites" : "Add to favourites"}
      aria-pressed={on}
      onClick={(e) => {
        e.stopPropagation();
        toggle(symbol);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          toggle(symbol);
        }
      }}
    >
      {on ? "★" : "☆"}
    </span>
  );
}
