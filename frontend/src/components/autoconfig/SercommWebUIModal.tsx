import React, { useState } from 'react';
import { X, Copy, Check, Terminal } from 'lucide-react';

interface Props {
  ip:        string;
  rootPass:  string;
  webuiPass: string;
  onClose:   () => void;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button
      onClick={copy}
      className="ml-2 p-1 rounded hover:bg-nms-surface text-nms-text-dim hover:text-nms-accent transition-colors flex-shrink-0"
      title="Copy to clipboard"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

function CodeBlock({ children, copyText }: { children: React.ReactNode; copyText?: string }) {
  return (
    <div className="flex items-start gap-2 bg-nms-surface border border-nms-border rounded px-3 py-2 font-mono text-xs text-nms-accent mt-1">
      <span className="flex-1 whitespace-pre-wrap break-all">{children}</span>
      {copyText && <CopyButton text={copyText} />}
    </div>
  );
}

export const SercommWebUIModal: React.FC<Props> = ({ ip, rootPass, webuiPass, onClose }) => {
  const displayIp   = ip       || '11.11.11.188';
  const displayRoot = rootPass || '(enter MAC address to derive)';
  const displayWeb  = webuiPass|| '(enter MAC address to derive)';

  const sshCmd     = `ssh root@${displayIp}`;
  const femtoCmd1  = `femto_cli sset Device.X_SCM_DeviceFeature.X_SCM_WebServerEnable="1"`;
  const femtoCmd2  = `femto_cli fsave`;
  const rebootCmd  = `reboot`;
  const webuiUrl   = `https://${displayIp}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-nms-surface border border-nms-border rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-nms-border flex-shrink-0">
          <div className="flex items-center gap-3">
            <Terminal className="w-5 h-5 text-nms-accent" />
            <div>
              <h2 className="text-base font-semibold text-nms-text">How to Enable the Sercomm WebUI</h2>
              <p className="text-xs text-nms-text-dim mt-0.5">One-time setup via SSH — only needed if WebUI is not already active</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-nms-surface-2 text-nms-text-dim">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 text-sm">

          {/* Generated credentials */}
          <div className="bg-nms-accent/5 border border-nms-accent/30 rounded-lg px-4 py-3 space-y-2">
            <p className="text-xs font-semibold text-nms-text">Generated Credentials (from MAC address)</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-nms-text-dim mb-1">Root SSH Password</p>
                <CodeBlock copyText={rootPass || ''}>{displayRoot}</CodeBlock>
              </div>
              <div>
                <p className="text-xs text-nms-text-dim mb-1">Debug WebUI Password</p>
                <CodeBlock copyText={webuiPass || ''}>{displayWeb}</CodeBlock>
              </div>
            </div>
          </div>

          {/* Step 1 */}
          <div>
            <p className="font-medium text-nms-text mb-1">
              <span className="text-nms-accent font-bold mr-2">1.</span>
              Connect the small cell's LAN port to your PC. Your PC should receive an IP via DHCP.
            </p>
          </div>

          {/* Step 2 */}
          <div>
            <p className="font-medium text-nms-text mb-1">
              <span className="text-nms-accent font-bold mr-2">2.</span>
              SSH as root using the generated password above:
            </p>
            <CodeBlock copyText={sshCmd}>{sshCmd}</CodeBlock>
            <p className="text-xs text-nms-text-dim mt-1 ml-1">
              Password: <span className="font-mono text-nms-text">{displayRoot}</span>
            </p>
          </div>

          {/* Step 3 */}
          <div>
            <p className="font-medium text-nms-text mb-1">
              <span className="text-nms-accent font-bold mr-2">3.</span>
              Enable the WebUI, save, and reboot:
            </p>
            <div className="space-y-1.5">
              <CodeBlock copyText={femtoCmd1}>{femtoCmd1}</CodeBlock>
              <CodeBlock copyText={femtoCmd2}>{femtoCmd2}</CodeBlock>
              <CodeBlock copyText={rebootCmd}>{rebootCmd}</CodeBlock>
            </div>
          </div>

          {/* Step 4 */}
          <div>
            <p className="font-medium text-nms-text mb-1">
              <span className="text-nms-accent font-bold mr-2">4.</span>
              After the device reboots, the WebUI will be available at:
            </p>
            <CodeBlock copyText={webuiUrl}>{webuiUrl}</CodeBlock>
          </div>

          {/* Step 5 */}
          <div>
            <p className="font-medium text-nms-text mb-1">
              <span className="text-nms-accent font-bold mr-2">5.</span>
              Log in using the <span className="text-nms-text font-mono">debug</span> username and the Debug WebUI password above:
            </p>
            <div className="grid grid-cols-2 gap-3 mt-2">
              <div>
                <p className="text-xs text-nms-text-dim mb-1">Username</p>
                <CodeBlock copyText="debug">debug</CodeBlock>
              </div>
              <div>
                <p className="text-xs text-nms-text-dim mb-1">Password</p>
                <CodeBlock copyText={webuiPass || ''}>{displayWeb}</CodeBlock>
              </div>
            </div>
            <p className="text-xs text-nms-text-dim mt-2">
              This is the admin account. Once logged in you can configure the radio manually or return here and use the ACS provisioning flow.
            </p>
          </div>

        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-nms-border flex-shrink-0 flex justify-end">
          <button onClick={onClose} className="nms-btn border border-nms-border text-nms-text-dim hover:text-nms-text hover:bg-nms-surface-2 text-sm">
            Close
          </button>
        </div>

      </div>
    </div>
  );
};
