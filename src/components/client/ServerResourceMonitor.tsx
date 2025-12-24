import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { 
  Cpu, 
  MemoryStick, 
  HardDrive, 
  Activity,
  Wifi,
  ArrowDown,
  ArrowUp
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface ResourceData {
  memory_bytes: number;
  memory_limit_bytes?: number;
  cpu_absolute: number;
  disk_bytes: number;
  disk_limit_bytes?: number;
  network_rx_bytes: number;
  network_tx_bytes: number;
  uptime: number;
}

interface ServerResourceMonitorProps {
  resources: ResourceData | null;
  limits?: {
    memory: number; // in MB
    disk: number; // in MB
    cpu: number; // percentage
  };
  isLive?: boolean;
}

const ServerResourceMonitor = ({ resources, limits, isLive = true }: ServerResourceMonitorProps) => {
  const [prevResources, setPrevResources] = useState<ResourceData | null>(null);
  const [networkDelta, setNetworkDelta] = useState({ rx: 0, tx: 0 });

  useEffect(() => {
    if (resources && prevResources) {
      setNetworkDelta({
        rx: Math.max(0, resources.network_rx_bytes - prevResources.network_rx_bytes),
        tx: Math.max(0, resources.network_tx_bytes - prevResources.network_tx_bytes),
      });
    }
    setPrevResources(resources);
  }, [resources]);

  const formatBytes = (bytes: number, decimals = 2) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
  };

  const formatBytesPerSec = (bytes: number) => {
    return formatBytes(bytes) + '/s';
  };

  const formatUptime = (seconds: number) => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (days > 0) return `${days}d ${hours}h ${mins}m`;
    if (hours > 0) return `${hours}h ${mins}m ${secs}s`;
    if (mins > 0) return `${mins}m ${secs}s`;
    return `${secs}s`;
  };

  const getUsageColor = (percentage: number) => {
    if (percentage >= 90) return 'text-red-500';
    if (percentage >= 70) return 'text-orange-500';
    if (percentage >= 50) return 'text-yellow-500';
    return 'text-green-500';
  };

  const getProgressColor = (percentage: number) => {
    if (percentage >= 90) return 'bg-red-500';
    if (percentage >= 70) return 'bg-orange-500';
    if (percentage >= 50) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  // Calculate percentages
  const memoryLimitBytes = limits?.memory ? limits.memory * 1024 * 1024 : (resources?.memory_limit_bytes || 1024 * 1024 * 1024);
  const diskLimitBytes = limits?.disk ? limits.disk * 1024 * 1024 : (resources?.disk_limit_bytes || 10 * 1024 * 1024 * 1024);
  const cpuLimit = limits?.cpu || 100;

  const memoryPercent = resources ? Math.min(100, (resources.memory_bytes / memoryLimitBytes) * 100) : 0;
  const diskPercent = resources ? Math.min(100, (resources.disk_bytes / diskLimitBytes) * 100) : 0;
  const cpuPercent = resources ? Math.min(100, (resources.cpu_absolute / cpuLimit) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* Live indicator */}
      {isLive && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
          </span>
          Live monitoring
        </div>
      )}

      {/* Main resource cards */}
      <div className="grid grid-cols-2 gap-3">
        {/* CPU */}
        <Card className="overflow-hidden">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-blue-500/10">
                  <Cpu className="w-4 h-4 text-blue-500" />
                </div>
                <span className="text-sm font-medium">CPU</span>
              </div>
              <span className={cn("text-xl font-bold tabular-nums", getUsageColor(cpuPercent))}>
                {resources?.cpu_absolute?.toFixed(1) || '0'}%
              </span>
            </div>
            <div className="space-y-1">
              <Progress 
                value={cpuPercent} 
                className="h-2"
                indicatorClassName={getProgressColor(cpuPercent)}
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Usage</span>
                <span>{cpuLimit}% limit</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Memory */}
        <Card className="overflow-hidden">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-purple-500/10">
                  <MemoryStick className="w-4 h-4 text-purple-500" />
                </div>
                <span className="text-sm font-medium">RAM</span>
              </div>
              <span className={cn("text-xl font-bold tabular-nums", getUsageColor(memoryPercent))}>
                {memoryPercent.toFixed(0)}%
              </span>
            </div>
            <div className="space-y-1">
              <Progress 
                value={memoryPercent} 
                className="h-2"
                indicatorClassName={getProgressColor(memoryPercent)}
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{formatBytes(resources?.memory_bytes || 0)}</span>
                <span>{formatBytes(memoryLimitBytes)}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Disk */}
        <Card className="overflow-hidden">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-orange-500/10">
                  <HardDrive className="w-4 h-4 text-orange-500" />
                </div>
                <span className="text-sm font-medium">Disk</span>
              </div>
              <span className={cn("text-xl font-bold tabular-nums", getUsageColor(diskPercent))}>
                {diskPercent.toFixed(0)}%
              </span>
            </div>
            <div className="space-y-1">
              <Progress 
                value={diskPercent} 
                className="h-2"
                indicatorClassName={getProgressColor(diskPercent)}
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{formatBytes(resources?.disk_bytes || 0)}</span>
                <span>{formatBytes(diskLimitBytes)}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Uptime */}
        <Card className="overflow-hidden">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-green-500/10">
                  <Activity className="w-4 h-4 text-green-500" />
                </div>
                <span className="text-sm font-medium">Uptime</span>
              </div>
            </div>
            <div className="text-xl font-bold tabular-nums text-green-500">
              {formatUptime(resources?.uptime || 0)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Network stats */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="p-2 rounded-lg bg-cyan-500/10">
              <Wifi className="w-4 h-4 text-cyan-500" />
            </div>
            <span className="text-sm font-medium">Network I/O</span>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <ArrowDown className="w-3 h-3 text-green-500" />
                <span>Download</span>
              </div>
              <div className="text-lg font-semibold tabular-nums">
                {formatBytes(resources?.network_rx_bytes || 0)}
              </div>
              <div className="text-xs text-green-500 tabular-nums">
                ↓ {formatBytesPerSec(networkDelta.rx / 10)}
              </div>
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <ArrowUp className="w-3 h-3 text-blue-500" />
                <span>Upload</span>
              </div>
              <div className="text-lg font-semibold tabular-nums">
                {formatBytes(resources?.network_tx_bytes || 0)}
              </div>
              <div className="text-xs text-blue-500 tabular-nums">
                ↑ {formatBytesPerSec(networkDelta.tx / 10)}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default ServerResourceMonitor;
