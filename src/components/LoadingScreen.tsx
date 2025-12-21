import { Loader2 } from "lucide-react";

const LoadingScreen = () => {
  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden">
      {/* Gradient Background */}
      <div className="absolute inset-0 bg-gradient-to-b from-[#1a4b8c] via-[#2d6cb5] to-[#4a8fd4]" />
      
      {/* Cloud decorations */}
      <div className="absolute inset-0 overflow-hidden">
        {/* Large clouds */}
        <div className="absolute top-[10%] left-[5%] w-32 h-16 bg-white/30 rounded-full blur-xl animate-float" />
        <div className="absolute top-[15%] right-[10%] w-40 h-20 bg-white/25 rounded-full blur-xl animate-float" style={{ animationDelay: '1s' }} />
        <div className="absolute top-[30%] left-[20%] w-24 h-12 bg-white/20 rounded-full blur-lg animate-float" style={{ animationDelay: '2s' }} />
        <div className="absolute bottom-[25%] right-[15%] w-36 h-18 bg-white/25 rounded-full blur-xl animate-float" style={{ animationDelay: '0.5s' }} />
        <div className="absolute bottom-[40%] left-[8%] w-28 h-14 bg-white/20 rounded-full blur-lg animate-float" style={{ animationDelay: '1.5s' }} />
        
        {/* Small clouds */}
        <div className="absolute top-[45%] right-[30%] w-20 h-10 bg-white/15 rounded-full blur-md animate-float" style={{ animationDelay: '2.5s' }} />
        <div className="absolute top-[60%] left-[35%] w-16 h-8 bg-white/20 rounded-full blur-md animate-float" style={{ animationDelay: '3s' }} />
        <div className="absolute bottom-[15%] left-[25%] w-24 h-12 bg-white/30 rounded-full blur-xl animate-float" style={{ animationDelay: '1.2s' }} />
      </div>
      
      {/* Loading content */}
      <div className="relative z-10 flex flex-col items-center gap-4">
        <div className="relative">
          {/* Outer glow ring */}
          <div className="absolute inset-0 w-16 h-16 rounded-full bg-white/20 blur-md animate-pulse" />
          
          {/* Spinner */}
          <Loader2 className="w-16 h-16 text-white animate-spin" />
        </div>
        
        <p className="text-white/90 text-lg font-medium tracking-wide animate-pulse">
          Loading...
        </p>
      </div>
    </div>
  );
};

export default LoadingScreen;
