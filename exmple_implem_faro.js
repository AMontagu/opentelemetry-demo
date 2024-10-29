/* 19/04/2023 - AM - INFO
This file allow us to use grafana faro. There was some complication as the faro SDK is relatively young.
Problems are:
  - Impossibility to set propagateTraceHeaderCorsUrls via getWebInstrumentations options that made us redefining all instrumentations: https://github.com/grafana/faro-web-sdk/issues/131

We are waiting for next release to see new options added to simplify this file. If you come some months or year later to fix/improve this file please read the issues and if options available use them to simplify this file.
  */
import { trace, context } from "@opentelemetry/api";
import {
  getWebInstrumentations,
  initializeFaro,
  InternalLoggerLevel,
} from "@grafana/faro-web-sdk";
import {
  TracingInstrumentation,
  FaroTraceExporter,
  FaroSessionSpanProcessor,
} from "@grafana/faro-web-tracing";
import { DocumentLoadInstrumentation } from "@opentelemetry/instrumentation-document-load";
import { FetchInstrumentation } from "@opentelemetry/instrumentation-fetch";
// INFO - MS - 26/06/2023 - removed in grafana-faro-web-sdk 1.1.1 - use for tracing user click interaction, keep comment as reminder
// import { UserInteractionInstrumentation } from "@opentelemetry/instrumentation-user-interaction";
import { XMLHttpRequestInstrumentation } from "@opentelemetry/instrumentation-xml-http-request";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { SemanticResourceAttributes } from "@opentelemetry/semantic-conventions";
import CustomUserSpanProcessor from "./CustomerUserSpanProcessor";
// INFO - AM - 15/03/2023 - To have debug  please uncomme the next two line and comment the first one
// import {trace, context, diag, DiagConsoleLogger, DiagLogLevel} from "@opentelemetry/api";
// diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);

const enableTelemetry = ["true", "True", 1, "1"].includes(
  process.env.VUE_APP_ENABLE_TELEMETRY
);
let faro = null;
const RECORD_PREFIX = "custom";

const initializeTracingAndLogging = (
  projectName,
  PackageJson,
  { maxExportBatchSize = 25, router = null } = {}
) => {
  if (enableTelemetry && !process.env.VUE_APP_GRAFANA_API_KEY) {
    console.warn("TELEMETRY ENABLE BUT VUE_APP_GRAFANA_API_KEY NOT SET");
  } else if (enableTelemetry) {
    const ignoreUrls = [process.env.VUE_APP_COLLECTOR_URL];

    let propagateTraceHeaderCorsUrls = process.env.VUE_APP_PROPAGATE_URLS;
    propagateTraceHeaderCorsUrls = propagateTraceHeaderCorsUrls.split(",");
    propagateTraceHeaderCorsUrls = propagateTraceHeaderCorsUrls.map(
      (url) => new RegExp(url)
    );

    faro = initializeFaro({
      url: process.env.VUE_APP_COLLECTOR_URL,
      apiKey: process.env.VUE_APP_GRAFANA_API_KEY,
      app: {
        name: projectName,
        version: PackageJson.version,
        [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]:
          process.env.VUE_APP_GRPC_API_ENV,
      },
      metas: [
        // INFO - AM - 19/04/2023 - Inject env in session attributes because other place do not work: https://github.com/grafana/agent/issues/3569
        {
          session: {
            attributes: { environment: process.env.VUE_APP_GRPC_API_ENV },
          },
        },
      ],
      internalLoggerLevel: InternalLoggerLevel.ERROR, // INFO - AM - 19/04/2023 - Set to VERBOSE or INFO to see all faro logs
      // metas: [{"test": {"test": "test"}}], // INFO - AM - 28/04/2023 - Only for issue. Do not copy: https://github.com/grafana/agent/issues/3569
      // dedupe: false // INFO - AM - 28/04/2023 - Set this to false if you are testing to send same log again and again. If true it will not send if laste log same than current log
      beforeSend: (item) => {
        // INFO - AM - 17/05/2023 - before send only here to upper case the log level to match python ones. See https://github.com/grafana/faro-web-sdk/issues/194
        if (item.type === "log") {
          // INFO - AM - 17/05/2023 - Python log use WARNING level instead of warn.
          if (item?.payload?.level === "warn") {
            item.payload.level = "warning";
          }
          let payload = {
            ...item.payload,
            level: item?.payload?.level.toUpperCase(),
          };
          item.payload = payload;
          return item;
        }
        return item;
      },
    });

    const spanProcessor = new CustomUserSpanProcessor(
      new FaroSessionSpanProcessor(
        new BatchSpanProcessor(new FaroTraceExporter({ api: faro.api }), {
          maxExportBatchSize,
        }), // INFO - AM - 19/04/2023 - Relace BatchSpanProcessor by SimpleSpanProcessor if you want to have unitary call to collector to help debu
        faro.metas
      ),
      faro.metas
    );

    const instrumentations = [
      new FetchInstrumentation({
        ignoreUrls,
        propagateTraceHeaderCorsUrls, // INFO - AM - 15/03/2023 - See https://github.com/open-telemetry/opentelemetry-js/blob/main/experimental/packages/opentelemetry-instrumentation-xml-http-request/src/xhr.ts#L109
      }),
      new XMLHttpRequestInstrumentation({
        ignoreUrls,
        propagateTraceHeaderCorsUrls,
      }),
      // INFO - AM - 19/04/2023 - Normally return anything because default is only 'click' event but we do no want this.
      // new UserInteractionInstrumentation({ eventNames: [] }),
      new DocumentLoadInstrumentation(),
    ];

    // INFO - AM - 20/04/2023 - See https://github.com/grafana/faro-web-sdk/issues/160
    faro.instrumentations.add(
      ...getWebInstrumentations(),
      new TracingInstrumentation({ instrumentations, spanProcessor })
    );

    faro.api.initOTEL(trace, context);

    if (router) {
      router.afterEach((to) => {
        faro.api.pushEvent("pageView", { path: to.fullPath });
      });
    }
  }
};

const setTelemetryUser = (user) => {
  if (!enableTelemetry) {
    return;
  }
  if (!faro) {
    console.error(
      `Faro not defined when setTelemetryUser, enableTelemetry=${enableTelemetry}, faro=`,
      faro
    );
    return;
  }
  faro.api.setUser({
    email: user.profile.email,
    id: user.profile.usermanagementUuid,
    username: user.profile.name,
    attributes: {
      groups: Array.isArray(user.profile.groups)
        ? user.profile.groups.join()
        : "",
      site: user.profile.site,
      codeSite: user.profile.codeSite,
      matricule: user.profile.matricule,
      sub: user.profile.sub,
    },
  });
  // INFO - AM - 19/04/2023 - Injectif env in session attributes because other place do not work: https://github.com/grafana/agent/issues/3569
  faro.metas.value.session.attributes[
    `${RECORD_PREFIX}_usermanagement_uuid`
  ] = user.profile.usermanagementUuid;
};

export default faro;
export { setTelemetryUser, initializeTracingAndLogging, faro };
