import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Mail, Save, Loader2, TestTube, CheckCircle2, AlertCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface SMTPSettings {
  id: string;
  host: string;
  port: number;
  username: string;
  password: string;
  from_email: string;
  from_name: string;
  encryption: string;
  enabled: boolean;
}

const SMTPConfig = () => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [settings, setSettings] = useState<SMTPSettings>({
    id: '',
    host: 'smtp.gmail.com',
    port: 587,
    username: '',
    password: '',
    from_email: '',
    from_name: '',
    encryption: 'tls',
    enabled: false,
  });

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const { data, error } = await supabase
        .from('smtp_settings')
        .select('*')
        .single();
      
      if (error && error.code !== 'PGRST116') throw error;
      if (data) {
        setSettings(data);
      }
    } catch (error: any) {
      console.error('Failed to fetch SMTP settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('smtp_settings')
        .upsert({
          ...settings,
          updated_at: new Date().toISOString(),
        });
      
      if (error) throw error;
      toast({ title: 'SMTP settings saved successfully' });
    } catch (error: any) {
      toast({ title: 'Failed to save settings', description: error.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-email', {
        body: { 
          action: 'test',
          to: settings.from_email,
        }
      });
      
      if (error) throw error;
      toast({ title: 'Test email sent', description: 'Check your inbox' });
    } catch (error: any) {
      toast({ title: 'Test failed', description: error.message, variant: 'destructive' });
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="border-primary/20">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/20">
              <Mail className="w-5 h-5 text-primary" />
            </div>
            <div>
              <CardTitle>SMTP Configuration</CardTitle>
              <CardDescription>Configure email settings for notifications</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Enable Toggle */}
          <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50">
            <div>
              <Label className="text-base">Enable Email Notifications</Label>
              <p className="text-sm text-muted-foreground">Send emails for payments and server updates</p>
            </div>
            <Switch
              checked={settings.enabled}
              onCheckedChange={(checked) => setSettings({ ...settings, enabled: checked })}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* SMTP Host */}
            <div className="space-y-2">
              <Label>SMTP Host</Label>
              <Input
                placeholder="smtp.gmail.com"
                value={settings.host}
                onChange={(e) => setSettings({ ...settings, host: e.target.value })}
              />
            </div>

            {/* SMTP Port */}
            <div className="space-y-2">
              <Label>SMTP Port</Label>
              <Input
                type="number"
                placeholder="587"
                value={settings.port}
                onChange={(e) => setSettings({ ...settings, port: parseInt(e.target.value) || 587 })}
              />
            </div>

            {/* Username */}
            <div className="space-y-2">
              <Label>Username</Label>
              <Input
                placeholder="your-email@gmail.com"
                value={settings.username}
                onChange={(e) => setSettings({ ...settings, username: e.target.value })}
              />
            </div>

            {/* Password */}
            <div className="space-y-2">
              <Label>Password / App Password</Label>
              <Input
                type="password"
                placeholder="••••••••"
                value={settings.password}
                onChange={(e) => setSettings({ ...settings, password: e.target.value })}
              />
            </div>

            {/* From Email */}
            <div className="space-y-2">
              <Label>From Email</Label>
              <Input
                type="email"
                placeholder="noreply@yourdomain.com"
                value={settings.from_email}
                onChange={(e) => setSettings({ ...settings, from_email: e.target.value })}
              />
            </div>

            {/* From Name */}
            <div className="space-y-2">
              <Label>From Name</Label>
              <Input
                placeholder="Game Hosting"
                value={settings.from_name}
                onChange={(e) => setSettings({ ...settings, from_name: e.target.value })}
              />
            </div>

            {/* Encryption */}
            <div className="space-y-2">
              <Label>Encryption</Label>
              <Select
                value={settings.encryption}
                onValueChange={(value) => setSettings({ ...settings, encryption: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tls">TLS</SelectItem>
                  <SelectItem value="ssl">SSL</SelectItem>
                  <SelectItem value="none">None</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Common Presets */}
          <div className="space-y-2">
            <Label>Quick Presets</Label>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSettings({ ...settings, host: 'smtp.gmail.com', port: 587, encryption: 'tls' })}
              >
                Gmail
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSettings({ ...settings, host: 'smtp.office365.com', port: 587, encryption: 'tls' })}
              >
                Outlook
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSettings({ ...settings, host: 'smtp.sendgrid.net', port: 587, encryption: 'tls' })}
              >
                SendGrid
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSettings({ ...settings, host: 'smtp.mailgun.org', port: 587, encryption: 'tls' })}
              >
                Mailgun
              </Button>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-4">
            <Button onClick={handleSave} disabled={saving} className="gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save Settings
            </Button>
            <Button variant="outline" onClick={handleTest} disabled={testing || !settings.enabled} className="gap-2">
              {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <TestTube className="w-4 h-4" />}
              Send Test Email
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Email Templates Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Email Notifications</CardTitle>
          <CardDescription>The following emails will be sent automatically</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
              <CheckCircle2 className="w-5 h-5 text-green-500" />
              <div>
                <p className="font-medium">Payment Confirmation</p>
                <p className="text-sm text-muted-foreground">Sent when payment is received</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
              <CheckCircle2 className="w-5 h-5 text-green-500" />
              <div>
                <p className="font-medium">Server Setup Complete</p>
                <p className="text-sm text-muted-foreground">Sent when server is ready with connection details</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
              <AlertCircle className="w-5 h-5 text-yellow-500" />
              <div>
                <p className="font-medium">Renewal Reminder</p>
                <p className="text-sm text-muted-foreground">Sent before service expires</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default SMTPConfig;
