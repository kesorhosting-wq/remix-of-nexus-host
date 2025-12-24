import { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Server, 
  Play, 
  Square, 
  RotateCcw, 
  Terminal, 
  Activity,
  HardDrive,
  Cpu,
  MemoryStick,
  ExternalLink,
  RefreshCw,
  Power,
  Loader2,
  Globe,
  Copy,
  CheckCircle2,
  Gauge
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import ServerResourceMonitor from './ServerResourceMonitor';

interface Order {
  id: string;
  status: string;
  price: number;
  billing_cycle: string;
  next_due_date: string;
  server_details: any;
  server_id: string | null;
  created_at: string;
  products?: { name: string; description: string } | null;
}

interface ServerControlPanelProps {
  order: Order;
  panelUrl: string | null;
  onClose: () => void;
  onRefresh: () => void;
}

interface ServerStatus {
  current_state: string;
  is_suspended: boolean;
  resources: {
    memory_bytes: number;
    cpu_absolute: number;
    disk_bytes: number;
    network_rx_bytes: number;
    network_tx_bytes: number;
    uptime: number;
  };
}

const ServerControlPanel = ({ order, panelUrl, onClose, onRefresh }: ServerControlPanelProps) => {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('overview');
  const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isLiveMonitoring, setIsLiveMonitoring] = useState(true);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const REFRESH_INTERVAL = 5000; // 5 seconds for real-time feel

  const fetchServerStatus = useCallback(async () => {
    if (!order.server_id) return;
    
    // Only show loading on initial fetch
    if (!serverStatus) setLoading(true);
    
    try {
      const { data, error } = await supabase.functions.invoke('pterodactyl', {
        body: { action: 'status', serverId: order.server_id }
      });
      
      if (error) throw error;
      setServerStatus(data);
    } catch (error: any) {
      console.error('Failed to fetch server status:', error);
      setIsLiveMonitoring(false);
    } finally {
      setLoading(false);
    }
  }, [order.server_id, serverStatus]);

  // Setup real-time polling
  useEffect(() => {
    fetchServerStatus();
    
    if (isLiveMonitoring) {
      intervalRef.current = setInterval(fetchServerStatus, REFRESH_INTERVAL);
    }
    
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [order.server_id, isLiveMonitoring]);

  // Toggle live monitoring
  const toggleLiveMonitoring = () => {
    setIsLiveMonitoring(prev => !prev);
    if (!isLiveMonitoring) {
      fetchServerStatus();
    }
  };

  const handleServerAction = async (action: 'start' | 'stop' | 'restart' | 'kill') => {
    if (!order.server_id) return;
    
    setActionLoading(action);
    try {
      const { data, error } = await supabase.functions.invoke('pterodactyl', {
        body: { action: 'power', serverId: order.server_id, signal: action }
      });
      
      if (error) throw error;
      
      toast({ title: `Server ${action} command sent` });
      setTimeout(fetchServerStatus, 2000);
    } catch (error: any) {
      toast({ title: 'Action failed', description: error.message, variant: 'destructive' });
    } finally {
      setActionLoading(null);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({ title: 'Copied to clipboard' });
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatUptime = (seconds: number) => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  };

  const getStatusColor = (state: string) => {
    switch (state) {
      case 'running': return 'bg-green-500';
      case 'starting': return 'bg-yellow-500';
      case 'stopping': return 'bg-orange-500';
      case 'offline': return 'bg-red-500';
      default: return 'bg-gray-500';
    }
  };

  const serverDetails = order.server_details || {};
  const serverAddress = serverDetails.ip && serverDetails.port 
    ? `${serverDetails.ip}:${serverDetails.port}` 
    : null;

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <CardHeader className="border-b">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary/20 to-primary/10 flex items-center justify-center">
                <Server className="w-6 h-6 text-primary" />
              </div>
              <div>
                <CardTitle className="text-xl">
                  {serverDetails.plan_name || order.products?.name || 'Server Control'}
                </CardTitle>
                <CardDescription className="flex items-center gap-2 mt-1">
                  {serverAddress && (
                    <button 
                      onClick={() => copyToClipboard(serverAddress)}
                      className="flex items-center gap-1 hover:text-foreground transition-colors font-mono text-xs"
                    >
                      <Globe className="w-3 h-3" />
                      {serverAddress}
                      {copied ? <CheckCircle2 className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                    </button>
                  )}
                  {serverStatus && (
                    <Badge className={`${getStatusColor(serverStatus.current_state)} text-white`}>
                      {serverStatus.current_state}
                    </Badge>
                  )}
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={fetchServerStatus} disabled={loading}>
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </Button>
              <Button variant="ghost" size="sm" onClick={onClose}>×</Button>
            </div>
          </div>
        </CardHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
          <div className="border-b px-6">
            <TabsList className="h-12 bg-transparent gap-4">
              <TabsTrigger value="overview" className="data-[state=active]:bg-primary/10">
                <Activity className="w-4 h-4 mr-2" />
                Overview
              </TabsTrigger>
              <TabsTrigger value="resources" className="data-[state=active]:bg-primary/10">
                <Gauge className="w-4 h-4 mr-2" />
                Resources
              </TabsTrigger>
              <TabsTrigger value="console" className="data-[state=active]:bg-primary/10">
                <Terminal className="w-4 h-4 mr-2" />
                Console
              </TabsTrigger>
            </TabsList>
          </div>

          <CardContent className="flex-1 overflow-auto p-6">
            <TabsContent value="overview" className="mt-0 space-y-6">
              {/* Quick Actions */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Button 
                  onClick={() => handleServerAction('start')}
                  disabled={actionLoading !== null}
                  className="flex-col h-auto py-4 bg-green-600 hover:bg-green-700"
                >
                  {actionLoading === 'start' ? <Loader2 className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5" />}
                  <span className="mt-1 text-xs">Start</span>
                </Button>
                <Button 
                  onClick={() => handleServerAction('stop')}
                  disabled={actionLoading !== null}
                  variant="destructive"
                  className="flex-col h-auto py-4"
                >
                  {actionLoading === 'stop' ? <Loader2 className="w-5 h-5 animate-spin" /> : <Square className="w-5 h-5" />}
                  <span className="mt-1 text-xs">Stop</span>
                </Button>
                <Button 
                  onClick={() => handleServerAction('restart')}
                  disabled={actionLoading !== null}
                  variant="secondary"
                  className="flex-col h-auto py-4"
                >
                  {actionLoading === 'restart' ? <Loader2 className="w-5 h-5 animate-spin" /> : <RotateCcw className="w-5 h-5" />}
                  <span className="mt-1 text-xs">Restart</span>
                </Button>
                <Button 
                  onClick={() => handleServerAction('kill')}
                  disabled={actionLoading !== null}
                  variant="outline"
                  className="flex-col h-auto py-4 border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground"
                >
                  {actionLoading === 'kill' ? <Loader2 className="w-5 h-5 animate-spin" /> : <Power className="w-5 h-5" />}
                  <span className="mt-1 text-xs">Kill</span>
                </Button>
              </div>

              {/* Resource Stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card className="bg-gradient-to-br from-blue-500/10 to-blue-500/5 border-blue-500/20">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 text-blue-500 mb-2">
                      <Cpu className="w-4 h-4" />
                      <span className="text-xs font-medium">CPU</span>
                    </div>
                    <div className="text-2xl font-bold">
                      {serverStatus?.resources?.cpu_absolute?.toFixed(1) || '0'}%
                    </div>
                  </CardContent>
                </Card>
                <Card className="bg-gradient-to-br from-purple-500/10 to-purple-500/5 border-purple-500/20">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 text-purple-500 mb-2">
                      <MemoryStick className="w-4 h-4" />
                      <span className="text-xs font-medium">Memory</span>
                    </div>
                    <div className="text-2xl font-bold">
                      {formatBytes(serverStatus?.resources?.memory_bytes || 0)}
                    </div>
                  </CardContent>
                </Card>
                <Card className="bg-gradient-to-br from-orange-500/10 to-orange-500/5 border-orange-500/20">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 text-orange-500 mb-2">
                      <HardDrive className="w-4 h-4" />
                      <span className="text-xs font-medium">Disk</span>
                    </div>
                    <div className="text-2xl font-bold">
                      {formatBytes(serverStatus?.resources?.disk_bytes || 0)}
                    </div>
                  </CardContent>
                </Card>
                <Card className="bg-gradient-to-br from-green-500/10 to-green-500/5 border-green-500/20">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 text-green-500 mb-2">
                      <Activity className="w-4 h-4" />
                      <span className="text-xs font-medium">Uptime</span>
                    </div>
                    <div className="text-2xl font-bold">
                      {formatUptime(serverStatus?.resources?.uptime || 0)}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Server Details */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Server Information</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between py-2 border-b border-border/50">
                    <span className="text-muted-foreground">Server ID</span>
                    <span className="font-mono">{order.server_id || 'N/A'}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-border/50">
                    <span className="text-muted-foreground">Address</span>
                    <span className="font-mono">{serverAddress || 'N/A'}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-border/50">
                    <span className="text-muted-foreground">Price</span>
                    <span>${order.price}/{order.billing_cycle}</span>
                  </div>
                  <div className="flex justify-between py-2">
                    <span className="text-muted-foreground">Next Due</span>
                    <span>{order.next_due_date ? new Date(order.next_due_date).toLocaleDateString() : 'N/A'}</span>
                  </div>
                </CardContent>
              </Card>

              {/* Go to Panel Button */}
              {panelUrl && order.server_id && (
                <Button 
                  className="w-full" 
                  size="lg"
                  onClick={() => window.open(`${panelUrl}/server/${order.server_id}`, '_blank')}
                >
                  <ExternalLink className="w-4 h-4 mr-2" />
                  Open Full Panel
                </Button>
              )}
            </TabsContent>

            <TabsContent value="resources" className="mt-0 space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Real-Time Resource Usage</h3>
                <Button
                  variant={isLiveMonitoring ? "default" : "outline"}
                  size="sm"
                  onClick={toggleLiveMonitoring}
                >
                  {isLiveMonitoring ? (
                    <>
                      <span className="relative flex h-2 w-2 mr-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                      </span>
                      Live
                    </>
                  ) : (
                    'Enable Live'
                  )}
                </Button>
              </div>
              
              <ServerResourceMonitor 
                resources={serverStatus?.resources || null}
                limits={order.server_details?.limits}
                isLive={isLiveMonitoring}
              />
              
              {/* Go to Panel for detailed stats */}
              {panelUrl && order.server_id && (
                <Button 
                  variant="outline"
                  className="w-full" 
                  onClick={() => window.open(`${panelUrl}/server/${order.server_id}`, '_blank')}
                >
                  <ExternalLink className="w-4 h-4 mr-2" />
                  View Detailed Stats in Panel
                </Button>
              )}
            </TabsContent>

            <TabsContent value="console" className="mt-0">
              <Card className="bg-black/90 border-primary/20">
                <CardContent className="p-0">
                  <ScrollArea className="h-[400px] p-4">
                    <div className="font-mono text-xs text-green-400 space-y-1">
                      <p className="text-muted-foreground">[Console output will appear here when connected]</p>
                      <p className="text-muted-foreground">For full console access, please use the panel:</p>
                      {panelUrl && order.server_id && (
                        <Button 
                          variant="link" 
                          className="text-primary p-0 h-auto"
                          onClick={() => window.open(`${panelUrl}/server/${order.server_id}/console`, '_blank')}
                        >
                          Open Console in Panel →
                        </Button>
                      )}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </TabsContent>
          </CardContent>
        </Tabs>
      </Card>
    </div>
  );
};

export default ServerControlPanel;
