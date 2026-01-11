import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Server, User, AlertCircle, CheckCircle, DollarSign } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface ServerToSync {
  id: number;
  uuid: string;
  external_id: string;
  name: string;
  email: string;
  suspended: boolean;
  limits: any;
  created_at: string;
  price: number;
}

interface SyncResult {
  success: boolean;
  totalInPanel: number;
  imported: number;
  skipped: number;
  errors: number;
  newUsersCreated: number;
  details: {
    imported: any[];
    skipped: any[];
    errors: any[];
    newUsersCreated: any[];
  };
}

interface SyncServersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
}

export function SyncServersDialog({ open, onOpenChange, onComplete }: SyncServersDialogProps) {
  const { toast } = useToast();
  const [step, setStep] = useState<"loading" | "preview" | "syncing" | "result">("loading");
  const [servers, setServers] = useState<ServerToSync[]>([]);
  const [existingServerIds, setExistingServerIds] = useState<Set<string>>(new Set());
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);

  const handleOpen = async (isOpen: boolean) => {
    if (isOpen) {
      setStep("loading");
      setServers([]);
      setSyncResult(null);
      await fetchServersFromPanel();
    }
    onOpenChange(isOpen);
  };

  const fetchServersFromPanel = async () => {
    try {
      // Fetch servers from panel via edge function (preview mode)
      const { data, error } = await supabase.functions.invoke("pterodactyl", {
        body: { action: "preview-sync" }
      });

      if (error) throw error;

      // Get existing orders to filter
      const { data: existingOrders } = await supabase
        .from("orders")
        .select("server_id");

      const existingIds = new Set(
        (existingOrders || []).map((o: any) => o.server_id).filter(Boolean)
      );
      setExistingServerIds(existingIds);

      // Map servers with default price
      const mappedServers: ServerToSync[] = (data.servers || [])
        .filter((s: any) => {
          const serverId = s.external_id || s.uuid;
          return !existingIds.has(serverId);
        })
        .map((s: any) => ({
          id: s.id,
          uuid: s.uuid,
          external_id: s.external_id || s.uuid,
          name: s.name,
          email: s.email,
          suspended: s.suspended,
          limits: s.limits,
          created_at: s.created_at,
          price: 0, // Default price - admin can edit
        }));

      setServers(mappedServers);
      setStep("preview");
    } catch (error: any) {
      console.error("Failed to fetch servers:", error);
      toast({
        title: "Failed to fetch servers",
        description: error.message,
        variant: "destructive",
      });
      onOpenChange(false);
    }
  };

  const updateServerPrice = (uuid: string, price: number) => {
    setServers(prev =>
      prev.map(s => (s.uuid === uuid ? { ...s, price } : s))
    );
  };

  const handleConfirmSync = async () => {
    setStep("syncing");

    try {
      // Build server prices map
      const serverPrices: Record<string, number> = {};
      servers.forEach(s => {
        serverPrices[s.uuid] = s.price;
      });

      const { data, error } = await supabase.functions.invoke("pterodactyl", {
        body: { 
          action: "sync-servers",
          serverPrices, // Pass custom prices
        }
      });

      if (error) throw error;

      setSyncResult(data);
      setStep("result");
      toast({
        title: "Sync completed!",
        description: `${data.imported || 0} imported, ${data.skipped || 0} skipped`,
      });
    } catch (error: any) {
      console.error("Sync failed:", error);
      toast({
        title: "Sync failed",
        description: error.message,
        variant: "destructive",
      });
      setStep("preview");
    }
  };

  const handleClose = () => {
    if (step === "result") {
      onComplete();
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogContent className="max-w-4xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Server className="w-5 h-5" />
            Sync Servers from Panel
          </DialogTitle>
          <DialogDescription>
            {step === "loading" && "Fetching servers from Pterodactyl panel..."}
            {step === "preview" && "Review and set prices for servers before importing."}
            {step === "syncing" && "Importing servers and creating orders..."}
            {step === "result" && "Sync completed! Review the results below."}
          </DialogDescription>
        </DialogHeader>

        {step === "loading" && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        )}

        {step === "preview" && (
          <>
            {servers.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">
                <CheckCircle className="w-12 h-12 mx-auto mb-4 text-green-500" />
                <p>All servers are already synced!</p>
              </div>
            ) : (
              <ScrollArea className="h-[400px] border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Server Name</TableHead>
                      <TableHead>User Email</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-32">
                        <div className="flex items-center gap-1">
                          <DollarSign className="w-4 h-4" />
                          Price/Month
                        </div>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {servers.map((server) => (
                      <TableRow key={server.uuid}>
                        <TableCell className="font-medium">{server.name}</TableCell>
                        <TableCell className="text-muted-foreground">{server.email}</TableCell>
                        <TableCell>
                          <Badge variant={server.suspended ? "destructive" : "default"}>
                            {server.suspended ? "Suspended" : "Active"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="relative">
                            <DollarSign className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              value={server.price}
                              onChange={(e) => updateServerPrice(server.uuid, parseFloat(e.target.value) || 0)}
                              className="pl-7 h-8 w-24"
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            )}
          </>
        )}

        {step === "syncing" && (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <p className="text-muted-foreground">Syncing {servers.length} servers...</p>
          </div>
        )}

        {step === "result" && syncResult && (
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-4">
              <div className="p-4 bg-green-500/10 rounded-lg text-center">
                <p className="text-2xl font-bold text-green-500">{syncResult.imported}</p>
                <p className="text-xs text-muted-foreground">Imported</p>
              </div>
              <div className="p-4 bg-yellow-500/10 rounded-lg text-center">
                <p className="text-2xl font-bold text-yellow-500">{syncResult.skipped}</p>
                <p className="text-xs text-muted-foreground">Skipped</p>
              </div>
              <div className="p-4 bg-red-500/10 rounded-lg text-center">
                <p className="text-2xl font-bold text-red-500">{syncResult.errors}</p>
                <p className="text-xs text-muted-foreground">Errors</p>
              </div>
              <div className="p-4 bg-blue-500/10 rounded-lg text-center">
                <p className="text-2xl font-bold text-blue-500">{syncResult.newUsersCreated}</p>
                <p className="text-xs text-muted-foreground">New Users</p>
              </div>
            </div>

            {syncResult.details.errors.length > 0 && (
              <div className="border border-destructive/50 rounded-lg p-4">
                <h4 className="font-medium text-destructive flex items-center gap-2 mb-2">
                  <AlertCircle className="w-4 h-4" />
                  Errors
                </h4>
                <ul className="text-sm space-y-1">
                  {syncResult.details.errors.map((err, i) => (
                    <li key={i} className="text-muted-foreground">
                      {err.name}: {err.error}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {syncResult.details.newUsersCreated.length > 0 && (
              <div className="border border-blue-500/50 rounded-lg p-4">
                <h4 className="font-medium text-blue-500 flex items-center gap-2 mb-2">
                  <User className="w-4 h-4" />
                  New Users Created
                </h4>
                <ul className="text-sm space-y-1">
                  {syncResult.details.newUsersCreated.map((user, i) => (
                    <li key={i} className="text-muted-foreground">
                      {user.email} - {user.serverCount} server(s)
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {step === "preview" && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button 
                onClick={handleConfirmSync} 
                disabled={servers.length === 0}
              >
                Import {servers.length} Server(s)
              </Button>
            </>
          )}
          {step === "result" && (
            <Button onClick={handleClose}>
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
