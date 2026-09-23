/* Vendored from https://github.com/piqnt/planck.js/blob/93dd64df0fd2e5388551b159bebc6306e7af580a/src/util/options.ts
 * MIT licensed; see LICENSE in the repository root.
 */
/** @internal */
export const options = function <T extends Record<PropertyKey, any>>(
  input: T,
  defaults: Record<PropertyKey, any>,
): T {
  if (input === null || typeof input === 'undefined') {
    // tslint:disable-next-line:no-object-literal-type-assertion
    input = {} as T;
  }

  const output: Record<PropertyKey, any> = { ...input };

  // tslint:disable-next-line:no-for-in
  for (const key in defaults) {
    if (defaults.hasOwnProperty(key) && typeof input[key] === 'undefined') {
      output[key] = defaults[key];
    }
  }

  if (typeof Object.getOwnPropertySymbols === 'function') {
    const symbols = Object.getOwnPropertySymbols(defaults);

    for (let i = 0; i < symbols.length; i++) {
      const symbol = symbols[i];

      if (
        defaults.propertyIsEnumerable(symbol) &&
        typeof input[symbol] === 'undefined'
      ) {
        output[symbol] = defaults[symbol];
      }
    }
  }

  return output as T;
};
