FROM quay.io/keycloak/keycloak:26.8.1 AS builder
ENV KC_DB=postgres KC_HEALTH_ENABLED=true KC_HTTP_RELATIVE_PATH=/auth \
    KC_HTTP_MANAGEMENT_RELATIVE_PATH=/ JAVA_OPTS_KC_HEAP="-Xms128m -Xmx512m"
RUN /opt/keycloak/bin/kc.sh build

FROM quay.io/keycloak/keycloak:26.8.1
COPY --from=builder /opt/keycloak/ /opt/keycloak/
ENTRYPOINT ["/opt/keycloak/bin/kc.sh"]
