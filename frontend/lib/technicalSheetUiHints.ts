/** Standard Technical Sheet — column header and price-mode hover copy (English). */

export const TS_HINT_CURRENT_PRICE =
  "Uses today's vendor and system prices to calculate PU and PT. Amounts update when costs change; they are not fixed to when this sheet version was saved.";

export const TS_HINT_CREATION_DATE =
  "Uses prices stored when this technical sheet version was created. PU and PT stay fixed for this version even if vendor prices change later.";

export const TS_HINT_PRICE_UNIT =
  "Price per kilogram (or per pound when toggled) for this ingredient. Shown for display only; stored values remain per kg.";

export const TS_HINT_PRICE_TOTAL =
  "Total ingredient cost for this row (PU × net weight). Displayed in dollars.";

export const TS_HINT_APPLY = `Choose whether saving updates only this technical sheet or also writes the New recipe values back to the recipe database.

Override — Updates this technical sheet version only. The recipe database is not changed.

Overwrite — Updates this technical sheet and applies the New recipe values to the recipe database.`;
