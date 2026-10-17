import { generateScene, type SceneRequest } from './scene';

onmessage = ({ data }: MessageEvent<SceneRequest>) => {
  const started = performance.now();

  try {
    postMessage({
      scene: generateScene(data),
      duration: performance.now() - started,
    });
  } catch (error) {
    postMessage({
      error: error instanceof Error ? error.message : JSON.stringify(error),
    });
  }
};
