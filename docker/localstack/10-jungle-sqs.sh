#!/bin/sh
set -eu
exec /opt/code/localstack/.venv/bin/python /opt/jungle/init_queues.py
