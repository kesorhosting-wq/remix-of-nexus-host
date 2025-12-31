import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Wallet, Check, X, Loader2, RefreshCw, Save, Settings, Zap, Globe, Link, Copy, Key } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface IkhodeStatus {
  connected: boolean;
  apiUrl?: string;
  wsSupported?: boolean;
}

// Config names match PHP extension exactly
interface IkhodeSettings {
  node_api_url: string;
  websocket_url: string;
  webhook_secret: string;
  custom_webhook_url: string;
}

const IkhodePaymentConfig = () => {
  const { toast } = useToast();
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<IkhodeStatus | null>(null);
  
  const [settings, setSettings] = useState<IkhodeSettings>({
    node_api_url: "",
    websocket_url: "",
    webhook_secret: "",
    custom_webhook_url: "",
  });

  // This webhook URL format is sent to Node.js API as callbackUrl
  const defaultWebhookUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ikhode-webhook/{invoice_id}`;
  const activeWebhookUrl = settings.custom_webhook_url || defaultWebhookUrl;

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    const { data } = await supabase
      .from("payment_gateways")
      .select("*")
      .eq("slug", "ikhode-bakong")
      .maybeSingle();

    if (data?.config) {
      const config = data.config as any;
      setSettings({
        node_api_url: config.node_api_url || "",
        websocket_url: config.websocket_url || "",
        webhook_secret: config.webhook_secret || "",
        custom_webhook_url: config.custom_webhook_url || "",
      });
    }
  };

  const testConnection = async () => {
    if (!settings.node_api_url) {
      toast({ 
        title: "Node.js API URL Required", 
        description: "Please enter your Node.js backend URL",
        variant: "destructive" 
      });
      return;
    }

    setTesting(true);
    try {
      const response = await fetch(settings.node_api_url.replace(/\/$/, ""));
      
      if (response.ok) {
        setStatus({
          connected: true,
          apiUrl: settings.node_api_url,
          wsSupported: !!settings.websocket_url,
        });
        toast({ title: "API connection successful!" });
      } else {
        throw new Error(`API returned ${response.status}`);
      }
    } catch (error: any) {
      console.error("Ikhode API test failed:", error);
      setStatus({ connected: false });
      toast({ 
        title: "Connection failed", 
        description: "Make sure your Node.js API is running and accessible",
        variant: "destructive" 
      });
    } finally {
      setTesting(false);
    }
  };

  const saveSettings = async () => {
    if (!settings.node_api_url) {
      toast({ 
        title: "Node.js API URL Required", 
        description: "Please enter your Node.js backend URL",
        variant: "destructive" 
      });
      return;
    }

    // Validate URL format
    try {
      new URL(settings.node_api_url);
      if (settings.websocket_url) {
        new URL(settings.websocket_url.replace("wss://", "https://").replace("ws://", "http://"));
      }
    } catch {
      toast({ 
        title: "Invalid URL", 
        description: "Please enter valid URLs",
        variant: "destructive" 
      });
      return;
    }
    
    setSaving(true);
    try {
      // Config matches PHP extension getConfig() exactly
      const configJson = {
        node_api_url: settings.node_api_url.replace(/\/$/, ""),
        websocket_url: settings.websocket_url,
        webhook_secret: settings.webhook_secret,
        custom_webhook_url: settings.custom_webhook_url,
      };

      const { data: existing } = await supabase
        .from("payment_gateways")
        .select("id")
        .eq("slug", "ikhode-bakong")
        .maybeSingle();

      if (existing) {
        await supabase
          .from("payment_gateways")
          .update({
            config: configJson,
            enabled: true,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id);
      } else {
        await supabase
          .from("payment_gateways")
          .insert({
            name: "KHQR Gateway",
            slug: "ikhode-bakong",
            description: "Ikhode Technologies Bakong KHQR Payment Gateway",
            icon: "wallet",
            enabled: true,
            config: configJson,
          });
      }

      toast({ title: "Settings saved!" });
    } catch (error: any) {
      toast({ title: "Failed to save", description: error.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const copyWebhookUrl = () => {
    navigator.clipboard.writeText(activeWebhookUrl);
    toast({ title: "Webhook URL copied!" });
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-white/20 backdrop-blur rounded-xl flex items-center justify-center">
              <Wallet className="w-6 h-6" />
            </div>
            <div>
              <CardTitle className="text-white">KHQR Gateway</CardTitle>
              <CardDescription className="text-white/80">
                Ikhode Technologies Bakong Payment
              </CardDescription>
            </div>
          </div>
          {status && (
            <Badge className={status.connected ? "bg-white/20 text-white border-0" : "bg-red-500 text-white border-0"}>
              {status.connected ? (
                <><Check className="w-3 h-3 mr-1" /> Connected</>
              ) : (
                <><X className="w-3 h-3 mr-1" /> Disconnected</>
              )}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-6">
        <Tabs defaultValue="settings" className="w-full">
          <TabsList className="grid w-full grid-cols-2 mb-6">
            <TabsTrigger value="settings" className="gap-2">
              <Settings className="w-4 h-4" />
              Settings
            </TabsTrigger>
            <TabsTrigger value="test" className="gap-2">
              <RefreshCw className="w-4 h-4" />
              Test
            </TabsTrigger>
          </TabsList>

          <TabsContent value="settings" className="space-y-4">
            <div className="space-y-4">
              {/* Node.js API URL - matches PHP config */}
              <div className="space-y-2">
                <Label htmlFor="node_api_url">Node.js API URL *</Label>
                <div className="relative">
                  <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="node_api_url"
                    placeholder="https://api.ikhode.site"
                    value={settings.node_api_url}
                    onChange={(e) => setSettings({ ...settings, node_api_url: e.target.value })}
                    className="pl-10"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  The public, https:// URL of your Node.js backend (e.g., https://api.ikhode.site)
                </p>
              </div>

              {/* WebSocket URL - matches PHP config */}
              <div className="space-y-2">
                <Label htmlFor="websocket_url">WebSocket URL *</Label>
                <div className="relative">
                  <Zap className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="websocket_url"
                    placeholder="wss://api.ikhode.site:8080"
                    value={settings.websocket_url}
                    onChange={(e) => setSettings({ ...settings, websocket_url: e.target.value })}
                    className="pl-10"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  The public, wss:// URL of your WebSocket server (e.g., wss://api.ikhode.site:8080)
                </p>
              </div>

              {/* Webhook Secret - matches PHP config */}
              <div className="space-y-2">
                <Label htmlFor="webhook_secret">Webhook Secret *</Label>
                <div className="relative">
                  <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="webhook_secret"
                    type="password"
                    placeholder="Your webhook secret"
                    value={settings.webhook_secret}
                    onChange={(e) => setSettings({ ...settings, webhook_secret: e.target.value })}
                    className="pl-10"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  A secret key used by your Node.js server to authorize the payment confirmation webhook
                </p>
              </div>

              {/* Custom Webhook URL */}
              <div className="space-y-2">
                <Label htmlFor="custom_webhook_url">Custom Webhook URL (Optional)</Label>
                <div className="relative">
                  <Link className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="custom_webhook_url"
                    placeholder={defaultWebhookUrl}
                    value={settings.custom_webhook_url}
                    onChange={(e) => setSettings({ ...settings, custom_webhook_url: e.target.value })}
                    className="pl-10 font-mono text-xs"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Leave empty to use default. Use <code className="bg-muted px-1 rounded">{"{invoice_id}"}</code> as placeholder for the invoice ID.
                </p>
              </div>

              {/* Active Webhook URL Info */}
              <div className="p-4 bg-muted rounded-lg space-y-2">
                <Label className="text-sm font-medium flex items-center gap-2">
                  <Link className="w-4 h-4" />
                  Active Webhook URL (sent to your API)
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    value={activeWebhookUrl}
                    readOnly
                    className="font-mono text-xs bg-background"
                  />
                  <Button variant="outline" size="icon" onClick={copyWebhookUrl}>
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {settings.custom_webhook_url ? "Using custom URL" : "Using default URL"} - sent as callbackUrl when generating KHQR
                </p>
              </div>

              <div className="p-4 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg">
                <p className="text-sm font-medium text-blue-800 dark:text-blue-200 mb-2">
                  How It Works (matches PHP extension)
                </p>
                <ol className="text-xs text-blue-700 dark:text-blue-300 space-y-1 list-decimal list-inside">
                  <li>We call POST /generate-khqr with amount, transactionId, callbackUrl, secret</li>
                  <li>Your API returns qrCodeData (base64 QR image)</li>
                  <li>Your API polls Bakong for payment status</li>
                  <li>On success, your API calls our webhook with Bearer token auth</li>
                  <li>WebSocket broadcasts payment_success for instant UI update</li>
                </ol>
              </div>
            </div>

            <Button onClick={saveSettings} disabled={saving} className="w-full gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save Settings
            </Button>
          </TabsContent>

          <TabsContent value="test" className="space-y-4">
            {status?.connected && (
              <div className="p-4 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg space-y-2">
                <p className="text-sm font-medium text-green-800 dark:text-green-200">
                  ✓ API Connected
                </p>
                <div className="text-sm space-y-1">
                  <div>
                    <span className="text-muted-foreground">Node.js API:</span>
                    <span className="ml-2 font-mono text-xs break-all">{status.apiUrl}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">WebSocket:</span>
                    <span className="ml-2 font-mono text-xs">{settings.websocket_url || "Not configured"}</span>
                  </div>
                </div>
              </div>
            )}

            {!status?.connected && status !== null && (
              <div className="p-4 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg">
                <p className="text-sm font-medium text-red-800 dark:text-red-200">
                  ✗ Connection Failed
                </p>
                <p className="text-xs text-red-700 dark:text-red-300 mt-1">
                  Make sure your Node.js API is running and accessible.
                </p>
              </div>
            )}

            <div className="p-4 bg-muted rounded-lg space-y-3">
              <p className="text-sm font-medium">Expected API Endpoints</p>
              <ul className="text-xs text-muted-foreground space-y-2 font-mono">
                <li>GET / - Health check</li>
                <li>POST /generate-khqr - Generate KHQR code</li>
                <li>WS :8080 - Real-time payment updates</li>
              </ul>
            </div>

            <Button 
              onClick={testConnection} 
              disabled={testing || !settings.node_api_url} 
              variant="outline" 
              className="w-full gap-2"
            >
              {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Test Connection
            </Button>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
};

export default IkhodePaymentConfig;
