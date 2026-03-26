# Hosted / rented appliance — operations outline

One-page checklist for **fixed-SKU** appliances shipped or renting. Application features stay in-repo; this is **how we run** the business layer.

## Golden image

- **Pin** OS image (e.g. Ubuntu LTS or Debian) + **kernel** + Docker version per SKU.  
- **Pre-bake** Compose project + known-good `FFMPEG_HWACCEL` (or `none`) per SKU after QA.  
- **No default** `SECRET_KEY` in shipped images—inject at first boot or provisioning API.  
- Store **image hash** and **bill of materials** (BIOS, NIC, storage model) per SKU.

## Updates

- **Staged** rollouts: canary appliances → fleet.  
- **Rollback**: keep previous Compose tag and image digests **N** versions back.  
- Document **camera firmware** interactions when upgrading FFmpeg/go2rtc.  
- Admins use **Configuration → Maintenance** in the web UI for diagnostics JSON and recorder status; upgrades remain **pull/redeploy** per project documentation.

## Monitoring (minimum)


| Signal                                            | Action                                |
| ------------------------------------------------- | ------------------------------------- |
| Disk free % on recordings volume                  | Page before retention cannot run      |
| Recorder process / `RECORDER_INTERNAL_STATUS_URL` | Restart policy + alert                |
| go2rtc `/api/streams` health                      | Correlates with “all cameras offline” |
| Load average / CPU steal (VM)                     | Capacity planning                     |


## Security

- **TLS** termination at nginx or edge; rotate certs.  
- **VPN** or zero-trust admin access—no raw SSH exposed to internet by default.  
- **Secrets**: `SECRET_KEY`, DB backups encryption keys—per-tenant where applicable.  
- **Logging**: avoid shipping raw RTSP credentials in logs; redact URLs.

## Support

- Remote diagnostics: admin **GET** `/api/health/diagnostics` (see [hw-diagnostics-spec.md](hw-diagnostics-spec.md)).  
- Attach **regression bundle** from [nvr-replacement-lab.md](nvr-replacement-lab.md) for escalations.

## Tie-in to sizing

- Map each **SKU** to a row in [hardware-sizing.md](hardware-sizing.md) (max cameras, max Mbps ingress, disk TB).  
- SLA text should match **measured** soak tests, not theoretical peaks.

