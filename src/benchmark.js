// Benchmark-only query switches, compiled away from every normal build. Kept
// as a function rather than an object, so every call site works whether or
// not the real implementation below survives the build.
export let benchmarkFlag = () => false;

// @ifdef BENCHMARK
const benchmarkParams = new URLSearchParams(location.search);

benchmarkFlag = (name) => benchmarkParams.has(name);
// @endif
