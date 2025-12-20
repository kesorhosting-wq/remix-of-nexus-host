import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

interface Egg {
  id: number;
  name: string;
  docker_image: string;
  startup: string;
}

interface Nest {
  id: number;
  name: string;
  eggs: Egg[];
}

interface Node {
  id: number;
  name: string;
  memory: number;
  disk: number;
}

interface PanelData {
  nests: Nest[];
  nodes: Node[];
}

export function usePterodactylData() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [panelData, setPanelData] = useState<PanelData | null>(null);

  const fetchPanelData = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      const { data, error: fnError } = await supabase.functions.invoke("pterodactyl", {
        body: { action: "get-panel-data" },
      });

      if (fnError) throw fnError;
      if (data.error) throw new Error(data.error);

      setPanelData(data);
      return data;
    } catch (err: any) {
      console.error("Error fetching panel data:", err);
      setError(err.message || "Failed to fetch panel data");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPanelData();
  }, [fetchPanelData]);

  const getEggsForNest = useCallback((nestId: number): Egg[] => {
    if (!panelData) return [];
    const nest = panelData.nests.find(n => n.id === nestId);
    return nest?.eggs || [];
  }, [panelData]);

  return {
    loading,
    error,
    panelData,
    nests: panelData?.nests || [],
    nodes: panelData?.nodes || [],
    getEggsForNest,
    refetch: fetchPanelData,
  };
}
