// Vietnamese dictionary, keyed by the English text. Split by area so they can be edited independently.
import shell from "./vi-shell.js";
import panels from "./vi-panels.js";
import advisors from "./vi-advisors.js";
import data from "./vi-data.js";

export const VI = Object.assign(Object.create(null), data, shell, panels, advisors);
