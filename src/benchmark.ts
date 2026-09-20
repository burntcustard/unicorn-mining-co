// Benchmark-only query switches, compiled away from every normal build. Kept
// as a function rather than an object, so every call site works whether or
// not the real implementation below survives the build.
// eslint-disable-next-line no-unused-vars -- production stub shares the benchmark signature
export let benchmarkFlag = (name: string) => false;

// @ifdef BENCHMARK
const benchmarkParams = new URLSearchParams(location.search);

benchmarkFlag = (name: string) => benchmarkParams.has(name);
// @endif
