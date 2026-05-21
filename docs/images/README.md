# Documentation Images

Place screenshots here for the documentation guides.

## remote-upf-guide.md

| Filename | What to capture |
|---|---|
| `01-upf-config-routable-ip.png` | Config → UPF tab — PFCP server address `10.0.1.157`, GTP-U server address `10.0.1.157` |
| `02-smf-pfcp-upf-clients.png` | Config → SMF tab — PFCP server `10.0.1.155`, UPF client list showing both `10.0.1.157` (no DNN) and `172.16.0.40` (dnn: edge) |
| `03-smf-session-pools-routing.png` | Config → SMF — Session Pools section showing edge pool first with blue "Remote UPF" badge, internet pools below with green "Local UPF" badge |
| `04-services-restart.png` | Services page — open5gs-upfd and open5gs-smfd both green/active after restart |
| `05-remote-upf-generator-form.png` | Config → UPF tab → Remote UPF Config Generator — form filled with edge site values (172.16.0.40, 172.16.0.41, edge, 10.47.0.0/24) |
| `06-remote-upf-generated-yaml.png` | Config → UPF tab → Remote UPF Config Generator — generated YAML config displayed on screen ready to copy |
