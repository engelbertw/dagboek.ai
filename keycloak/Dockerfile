# Keycloak voor dagboek.ai (Railway): realm en inlogthema zitten in het image, zodat de omgeving reproduceerbaar is.
FROM quay.io/keycloak/keycloak:26.2.1 AS bouw
ENV KC_DB=postgres KC_HEALTH_ENABLED=true
COPY themes/ /opt/keycloak/themes/
RUN /opt/keycloak/bin/kc.sh build

FROM quay.io/keycloak/keycloak:26.2.1
COPY --from=bouw /opt/keycloak/ /opt/keycloak/
COPY realm-dagboek.json /opt/keycloak/data/import/realm-dagboek.json
# Alleen de eerste start importeert de realm (een bestaande realm wordt niet overschreven). Latere wijzigingen: via de admin-console.
ENTRYPOINT ["/opt/keycloak/bin/kc.sh"]
CMD ["start", "--optimized", "--import-realm"]
