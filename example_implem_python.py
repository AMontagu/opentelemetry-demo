import logging
import os

from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.django import DjangoInstrumentor
from opentelemetry.instrumentation.grpc import (
    GrpcAioInstrumentorClient,
    GrpcInstrumentorClient,
)
from opentelemetry.instrumentation.logging import LoggingInstrumentor
from opentelemetry.instrumentation.psycopg2 import Psycopg2Instrumentor
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor, ConsoleSpanExporter

from custom.monitoring.aiokafka import AIOKafkaInstrumentor

GRPC_API_IS_ASYNC_ENV_NAME = "GRPC_API_IS_ASYNC"
ENABLE_TELEMETRY_ENV_NAME = "ENABLE_TELEMETRY"
ENVIRONMENT_ENV_NAME = "ENVIRONMENT"


def instrument_app(*, debug=False):
    if not os.environ.get(ENABLE_TELEMETRY_ENV_NAME, "True") == "True":
        return

    logging.captureWarnings(True)

    provider = TracerProvider()
    trace.set_tracer_provider(provider)

    # INFO - FB - 10/01/2023 - Enable if you want to print opentelemetry message on terminal
    if debug:
        trace.get_tracer_provider().add_span_processor(
            BatchSpanProcessor(ConsoleSpanExporter())
        )
    trace.get_tracer_provider().add_span_processor(
        BatchSpanProcessor(OTLPSpanExporter(insecure=True))
    )

    service_is_async = os.environ.get(GRPC_API_IS_ASYNC_ENV_NAME, "True") == "True"

    if service_is_async:
        GrpcAioInstrumentorClient().instrument()
    else:
        GrpcInstrumentorClient().instrument()

    LoggingInstrumentor().instrument()
    DjangoInstrumentor().instrument(trace_provider=provider, is_sql_commentor_enabled=True)
    Psycopg2Instrumentor().instrument(
        trace_provider=provider, skip_dep_check=True, enable_commenter=True
    )
    AIOKafkaInstrumentor().instrument()
