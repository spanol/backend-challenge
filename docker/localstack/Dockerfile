FROM localstack/localstack:4.9.2@sha256:59373b4a27dba3ec15c4db0b7455f0cb68c8a42300e2cbbe362b440f9a131697
COPY docker/localstack/patch_fifo.py /opt/jungle/patch_fifo.py
RUN /opt/code/localstack/.venv/bin/python /opt/jungle/patch_fifo.py
COPY docker/localstack/init_queues.py /opt/jungle/init_queues.py
COPY --chmod=755 docker/localstack/10-jungle-sqs.sh /etc/localstack/init/ready.d/10-jungle-sqs.sh
