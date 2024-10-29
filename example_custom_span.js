// INFO - AM - 19/04/2023 - example from https://github.com/grafana/faro-web-sdk/blob/main/packages/web-tracing/src/sessionSpanProcessor.ts

// INFO - AM - 19/04/2023 - adds user management uuid and every other attributes setted in sessions to every span
export default class CustomUserSpanProcessor {
  constructor(processor, metas) {
    this.processor = processor;
    this.metas = metas;
  }

  forceFlush() {
    return this.processor.forceFlush();
  }

  onStart(span, parentContext) {
    const session = this.metas.value.session;

    if (session?.attributes) {
      Object.entries(session?.attributes).forEach(([key, value]) => {
        span.attributes[key] = value;
      });
    }

    this.processor.onStart(span, parentContext);
  }

  onEnd(span) {
    this.processor.onEnd(span);
  }

  shutdown() {
    return this.processor.shutdown();
  }
}
