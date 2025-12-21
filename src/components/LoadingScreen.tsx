import { Loader2 } from "lucide-react";
import apsaraBackground from "@/assets/loading-reference.jpg";

const LoadingScreen = () => {
  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden">
      {/* Apsara Background Image */}
      <div 
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: `url(${apsaraBackground})` }}
      />
      
      {/* Subtle overlay for better text visibility */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent" />
      
      {/* Loading content - positioned at bottom */}
      <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-3">
        <div className="relative">
          {/* Outer glow ring */}
          <div className="absolute inset-0 w-12 h-12 rounded-full bg-white/30 blur-md animate-pulse" />
          
          {/* Spinner */}
          <Loader2 className="w-12 h-12 text-white drop-shadow-lg animate-spin" />
        </div>
        
        <p className="text-white text-lg font-medium tracking-wide drop-shadow-lg animate-pulse">
          Loading...
        </p>
      </div>
    </div>
  );
};

export default LoadingScreen;
