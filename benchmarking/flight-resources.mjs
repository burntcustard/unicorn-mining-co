// Runs outside the game's property mangler: these are native Node APIs.
export const resourceRuntime = `
import {getHeapStatistics} from 'node:v8';
import {PerformanceObserver} from 'node:perf_hooks';
let gcMs = 0, gcCount = 0;
const observe = entries => { for (const entry of entries) { gcMs += entry.duration; gcCount++; } };
const observer = new PerformanceObserver(list => observe(list.getEntries()));
observer.observe({entryTypes:['gc']});
process.once('beforeExit', () => setTimeout(() => {
  observe(observer.takeRecords());
  observer.disconnect();
  console.error('FLIGHT_RESOURCES ' + JSON.stringify({
    peakRssMiB: process.resourceUsage().maxRSS / 1024,
    heapLimitMiB: getHeapStatistics().heap_size_limit / 2 ** 20,
    gcMs, gcCount
  }));
}, 20));
`;
