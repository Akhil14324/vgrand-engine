"use client";

import { useState } from "react";
import { CheckCircle2, Copy, XCircle } from "lucide-react";
import type { WaNumberDto } from "@catgpt/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { toast } from "@/components/ui/toaster";
import { ApiRequestError } from "@/lib/api";
import { useBrands } from "@/lib/hooks";
import { useConnectWa, useDisconnectWa, useReplaceWaToken, useWaStatus } from "@/lib/whatsapp-hooks";

const errText = (e: unknown, fb: string) => (e instanceof ApiRequestError ? e.message : fb);

function Row({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      {ok ? <CheckCircle2 className="size-4 text-emerald-600" /> : <XCircle className="size-4 text-destructive" />}
      {label}
    </li>
  );
}

function WebhookInfo() {
  const status = useWaStatus();
  const s = status.data;
  if (!s) return null;
  return (
    <Card className="space-y-2 p-4">
      <h3 className="text-sm font-semibold">Webhook (once per Meta app)</h3>
      <p className="text-xs text-muted-foreground">
        In Meta App Dashboard → WhatsApp → Configuration, set the callback URL below, use your verify token, and subscribe to <b>messages</b>.
      </p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-xs">{s.callbackUrl}</code>
        <Button size="icon" variant="ghost" aria-label="Copy callback URL" onClick={() => void navigator.clipboard.writeText(s.callbackUrl).then(() => toast.success("Copied"))}>
          <Copy className="size-4" />
        </Button>
      </div>
      <ul className="space-y-1">
        <Row ok={s.verifyTokenSet} label="WHATSAPP_WEBHOOK_VERIFY_TOKEN (or META_WEBHOOK_VERIFY_TOKEN) is set" />
        <Row ok={s.appSecretSet} label="WHATSAPP_APP_SECRET (or META_APP_SECRET) is set, so signatures are checked" />
        <Row ok={s.tokenKeySet} label="SOCIAL_TOKEN_KEY is set (tokens are stored encrypted)" />
      </ul>
    </Card>
  );
}

export function ConnectCard({ first, onDone, onCancel }: { first: boolean; onDone: () => void; onCancel?: () => void }) {
  const brands = useBrands();
  const connect = useConnectWa();
  const [brandId, setBrandId] = useState("");
  const [phoneNumberId, setPhone] = useState("");
  const [wabaId, setWaba] = useState("");
  const [accessToken, setToken] = useState("");
  const chosen = brandId || brands.data?.[0]?.id || "";
  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-4">
        <div>
          <h2 className="font-display text-base font-semibold">{first ? "Connect your first WhatsApp number" : "Add a brand number"}</h2>
          <p className="text-xs text-muted-foreground">
            Each brand uses its own WhatsApp Business number on Meta&apos;s Cloud API. In Meta Business Settings create a System User, give it the WhatsApp Business Account, generate a
            permanent token with <b>whatsapp_business_messaging</b> and <b>whatsapp_business_management</b>, then copy the IDs from WhatsApp Manager → API setup.
          </p>
        </div>
        <Select value={chosen} onChange={(e) => setBrandId(e.target.value)} aria-label="Brand">
          {(brands.data ?? []).map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </Select>
        <Input placeholder="Phone number ID" inputMode="numeric" value={phoneNumberId} onChange={(e) => setPhone(e.target.value)} />
        <Input placeholder="WhatsApp Business Account ID" inputMode="numeric" value={wabaId} onChange={(e) => setWaba(e.target.value)} />
        <Input placeholder="System user access token" type="password" autoComplete="off" value={accessToken} onChange={(e) => setToken(e.target.value)} />
        <div className="flex gap-2">
          <Button
            disabled={connect.isPending || !chosen || !phoneNumberId || !wabaId || accessToken.length < 20}
            onClick={() =>
              connect.mutate(
                { brandId: chosen, phoneNumberId, wabaId, accessToken },
                { onSuccess: () => { toast.success("WhatsApp connected"); setToken(""); onDone(); }, onError: (e) => toast.error(errText(e, "Could not connect")) },
              )
            }
          >
            {connect.isPending ? "Checking with Meta…" : "Connect"}
          </Button>
          {onCancel && <Button variant="ghost" onClick={onCancel}>Cancel</Button>}
        </div>
      </Card>
      <WebhookInfo />
    </div>
  );
}

export function ConnectionTab({ number }: { number: WaNumberDto }) {
  const disconnect = useDisconnectWa();
  const replace = useReplaceWaToken(number.id);
  const [token, setToken] = useState("");
  return (
    <div className="space-y-4">
      <Card className="space-y-1 p-4 text-sm">
        <div><b>{number.verifiedName ?? number.brandName}</b> · {number.displayPhone ?? "number"}</div>
        <div className="text-xs text-muted-foreground">Phone number ID {number.phoneNumberId}</div>
      </Card>
      <WebhookInfo />
      <Card className="space-y-2 p-4">
        <h3 className="text-sm font-semibold">Replace access token</h3>
        <p className="text-xs text-muted-foreground">Use this when the token expired or was revoked. The number, contacts and history stay.</p>
        <Input type="password" autoComplete="off" placeholder="New system user access token" value={token} onChange={(e) => setToken(e.target.value)} />
        <Button
          size="sm"
          variant="outline"
          disabled={replace.isPending || token.length < 20}
          onClick={() =>
            replace.mutate(token, { onSuccess: () => { setToken(""); toast.success("Token replaced"); }, onError: (e) => toast.error(errText(e, "Meta did not accept this token")) })
          }
        >
          {replace.isPending ? "Checking with Meta…" : "Replace token"}
        </Button>
      </Card>
      <Card className="flex items-center justify-between gap-3 p-4">
        <div className="text-sm">
          <b>Disconnect</b>
          <p className="text-xs text-muted-foreground">Deletes this number&apos;s contacts, chats, templates and broadcast history from CatGPT. Nothing is deleted at Meta.</p>
        </div>
        <Button
          variant="destructive"
          size="sm"
          disabled={disconnect.isPending}
          onClick={() => {
            if (window.confirm("Disconnect this number and delete its contacts and chats from CatGPT?")) disconnect.mutate(number.id, { onError: (e) => toast.error(errText(e, "Could not disconnect")) });
          }}
        >
          Disconnect
        </Button>
      </Card>
    </div>
  );
}
