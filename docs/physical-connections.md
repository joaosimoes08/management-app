# Physical connections

Physical topology links are persisted as `DeviceConnection` records. Each record can identify a source and destination device port, plus a label and notes for the cable route. The topology editor also shows each endpoint's rack and lets operators record patch panel name, panel port, rack side and cable label in the route notes.

Patch panels use the existing infrastructure inventory: create the panel as a device in its rack and add its ports as device interfaces. This keeps panel ports addressable by the same interface IDs as switch and server ports without introducing a second port catalog.

Connection provenance is stored in `DeviceConnection.source`. Manually documented links use `MANUAL` and display as “Documentada”; links carrying an inventory/discovery source such as `SNMP`, `AGENT` or `IMPORT` display as “Observada”. The migration assigns `MANUAL` to existing links. Discovery does not currently create physical link records automatically, so observed links only appear when an ingestion path writes them with an observed source.
