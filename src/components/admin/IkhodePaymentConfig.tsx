import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Wallet, Check, X, Loader2, RefreshCw, Save, Settings, Zap, Globe } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface IkhodeStatus {
  connected: boolean;
  apiUrl?: string;
  version?: string;
  wsSupported?: boolean;
}

interface IkhodeSettings {
  apiUrl: string;
  wsEnabled: boolean;
}

const IkhodePaymentConfig = () => {
  const { toast } = useToast();
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<IkhodeStatus | null>(null);
  
  const [settings, setSettings] = useState<IkhodeSettings>({
    apiUrl: "",
    wsEnabled: true,
  });

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    const { data } = await supabase
      .from("payment_gateways")
      .select("*")
      .eq("slug", "ikhode-bakong")
      .single();

    if (data?.config) {
      const config = data.config as any;
      setSettings({
        apiUrl: config.apiUrl || "",
        wsEnabled: config.wsEnabled !== false,
      });
    }
  };

  const testConnection = async () => {
    if (!settings.apiUrl) {
      toast({ 
        title: "API URL Required", 
        description: "Please enter your Ikhode Payment API URL",
        variant: "destructive" 
      });
      return;
    }

    setTesting(true);
    try {
      // Test the API by calling the health/status endpoint
      const response = await fetch(`${settings.apiUrl.replace(/\/$/, "")}/api/v1/banks`);
      
      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }
      
      const data = await response.json();
      
      setStatus({
        connected: true,
        apiUrl: settings.apiUrl,
        version: "1.0",
        wsSupported: settings.wsEnabled,
      });
      
      toast({ title: "API connection successful!", description: `Found ${data.length || 0} banks` });
    } catch (error: any) {
      console.error("Ikhode API test failed:", error);
      setStatus({ connected: false });
      toast({ 
        title: "Connection failed", 
        description: error.message || "Could not connect to the API",
        variant: "destructive" 
      });
    } finally {
      setTesting(false);
    }
  };

  const saveSettings = async () => {
    if (!settings.apiUrl) {
      toast({ 
        title: "API URL Required", 
        description: "Please enter your Ikhode Payment API URL",
        variant: "destructive" 
      });
      return;
    }

    // Validate URL format
    try {
      new URL(settings.apiUrl);
    } catch {
      toast({ 
        title: "Invalid URL", 
        description: "Please enter a valid URL (e.g., https://your-api.ngrok.io)",
        variant: "destructive" 
      });
      return;
    }
    
    setSaving(true);
    try {
      const configJson = {
        apiUrl: settings.apiUrl.replace(/\/$/, ""), // Remove trailing slash
        wsEnabled: settings.wsEnabled,
      };

      // Check if gateway exists
      const { data: existing } = await supabase
        .from("payment_gateways")
        .select("id")
        .eq("slug", "ikhode-bakong")
        .single();

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
            name: "Ikhode Bakong KHQR",
            slug: "ikhode-bakong",
            description: "Ikhode Technologies Bakong Payment API",
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

  return (
    <Card className="overflow-hidden">
      <CardHeader className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-white/20 backdrop-blur rounded-xl flex items-center justify-center">
              <Wallet className="w-6 h-6" />
            </div>
            <div>
              <CardTitle className="text-white">Ikhode Payment API</CardTitle>
              <CardDescription className="text-white/80">
                Connect to your local/ngrok Bakong KHQR API
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
              <div className="space-y-2">
                <Label htmlFor="apiUrl">API Base URL *</Label>
                <div className="relative">
                  <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="apiUrl"
                    placeholder="https://your-api.ngrok.io or http://localhost:3000"
                    value={settings.apiUrl}
                    onChange={(e) => setSettings({ ...settings, apiUrl: e.target.value })}
                    className="pl-10"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Your ngrok URL or local API URL where the Ikhode Bakong Payment API is running
                </p>
              </div>

              <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
                <div className="flex items-center gap-3">
                  <Zap className="w-5 h-5 text-primary" />
                  <div>
                    <p className="text-sm font-medium">Real-time WebSocket</p>
                    <p className="text-xs text-muted-foreground">
                      Enable WebSocket for instant payment updates
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant={settings.wsEnabled ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSettings({ ...settings, wsEnabled: !settings.wsEnabled })}
                >
                  {settings.wsEnabled ? "Enabled" : "Disabled"}
                </Button>
              </div>

              <div className="p-4 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg">
                <p className="text-sm font-medium text-blue-800 dark:text-blue-200 mb-2">
                  API Endpoints Used
                </p>
                <ul className="text-xs text-blue-700 dark:text-blue-300 space-y-1 font-mono">
                  <li>POST /api/v1/generate-khqr - Generate QR code</li>
                  <li>GET /api/v1/banks - Get supported banks</li>
                  <li>WS /ws - Real-time payment updates</li>
                </ul>
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
                  API Connected
                </p>
                <div className="text-sm space-y-1">
                  <div>
                    <span className="text-muted-foreground">API URL:</span>
                    <span className="ml-2 font-mono text-xs break-all">{status.apiUrl}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">WebSocket:</span>
                    <span className="ml-2">{status.wsSupported ? "✓ Enabled" : "✗ Disabled"}</span>
                  </div>
                </div>
              </div>
            )}

            {!status?.connected && status !== null && (
              <div className="p-4 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg">
                <p className="text-sm font-medium text-red-800 dark:text-red-200">
                  Connection Failed
                </p>
                <p className="text-xs text-red-700 dark:text-red-300 mt-1">
                  Make sure your API is running and the URL is correct.
                  If using ngrok, ensure the tunnel is active.
                </p>
              </div>
            )}

            <div className="p-4 bg-muted rounded-lg space-y-3">
              <p className="text-sm font-medium">Setup Instructions</p>
              <ol className="text-xs text-muted-foreground space-y-2 list-decimal list-inside">
                <li>Clone the Ikhode Bakong Payment API from GitHub</li>
                <li>Run <code className="bg-background px-1 rounded">npm install</code> and <code className="bg-background px-1 rounded">npm start</code></li>
                <li>Start ngrok: <code className="bg-background px-1 rounded">ngrok http 3000</code></li>
                <li>Copy the ngrok URL and paste it above</li>
              </ol>
            </div>

            <Button 
              onClick={testConnection} 
              disabled={testing || !settings.apiUrl} 
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
