// Use a string value at the CDP/BiDi boundary; object remote values differ.
export async function browserAction(
  evaluate: (expression: string) => Promise<string>,
  name: string,
) {
  return JSON.parse(
    await evaluate(
      `(async()=>JSON.stringify(await Reflect.get(window,'perf-capture')(${JSON.stringify(`/${name}`)})))()`,
    ),
  );
}
