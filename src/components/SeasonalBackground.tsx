import { useGameStore } from "@/store/gameStore";

// Seasonal video backgrounds and greetings
const seasonalConfig: Record<string, { 
  videoUrl: string; 
  greeting: string; 
  subtext?: string;
  overlayColor: string;
}> = {
  christmas: {
    videoUrl: "https://cdn.pixabay.com/video/2020/12/17/59929-493095375_large.mp4",
    greeting: "Merry Christmas!",
    subtext: "Wishing you joy and happiness",
    overlayColor: "from-red-900/60 via-green-900/40 to-red-900/60",
  },
  halloween: {
    videoUrl: "https://cdn.pixabay.com/video/2019/10/28/28476-369488217_large.mp4",
    greeting: "Happy Halloween!",
    subtext: "Have a spooky season",
    overlayColor: "from-orange-900/70 via-purple-900/50 to-black/70",
  },
  newyear: {
    videoUrl: "https://cdn.pixabay.com/video/2023/12/28/195105-899068518_large.mp4",
    greeting: "Happy New Year 2025!",
    subtext: "Wishing you a prosperous year ahead",
    overlayColor: "from-blue-900/60 via-purple-900/40 to-blue-900/60",
  },
  valentine: {
    videoUrl: "https://cdn.pixabay.com/video/2020/02/09/32119-391182282_large.mp4",
    greeting: "Happy Valentine's Day!",
    subtext: "Spread love and joy",
    overlayColor: "from-pink-900/60 via-red-900/40 to-pink-900/60",
  },
  easter: {
    videoUrl: "https://cdn.pixabay.com/video/2019/04/11/22859-330879996_large.mp4",
    greeting: "Happy Easter!",
    subtext: "Hope your day is egg-stra special",
    overlayColor: "from-yellow-900/50 via-green-900/30 to-pink-900/50",
  },
};

const SeasonalBackground = () => {
  const { seasonalThemes } = useGameStore();
  const activeTheme = seasonalThemes.find((t) => t.enabled);

  if (!activeTheme) return null;

  const config = seasonalConfig[activeTheme.id];
  if (!config) return null;

  return (
    <>
      {/* Full-screen video background - behind all content */}
      <div className="fixed inset-0 -z-10 pointer-events-none overflow-hidden">
        {/* Video */}
        <video
          autoPlay
          loop
          muted
          playsInline
          className="absolute inset-0 w-full h-full object-cover"
        >
          <source src={config.videoUrl} type="video/mp4" />
        </video>

        {/* Gradient overlay for readability */}
        <div className={`absolute inset-0 bg-gradient-to-b ${config.overlayColor}`} />

        {/* Greeting text - positioned at top */}
        <div className="absolute top-20 left-0 right-0 flex flex-col items-center justify-center text-center px-4 animate-fade-up">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-4xl md:text-6xl animate-float">{activeTheme.decorations[0]}</span>
            <h2 className="text-3xl md:text-5xl lg:text-6xl font-bold text-white drop-shadow-lg font-heading">
              {config.greeting}
            </h2>
            <span className="text-4xl md:text-6xl animate-float" style={{ animationDelay: "0.5s" }}>
              {activeTheme.decorations[1]}
            </span>
          </div>
          {config.subtext && (
            <p className="text-lg md:text-xl text-white/90 drop-shadow-md mt-2">
              {config.subtext}
            </p>
          )}
        </div>

        {/* Decorations scattered around */}
        <div className="absolute bottom-10 left-10 text-4xl md:text-6xl animate-float hidden lg:block">
          {activeTheme.decorations[2]}
        </div>
        <div className="absolute bottom-20 right-10 text-4xl md:text-6xl animate-float hidden lg:block" style={{ animationDelay: "1s" }}>
          {activeTheme.decorations[3]}
        </div>
        <div className="absolute top-1/2 left-5 text-3xl md:text-5xl animate-float hidden lg:block" style={{ animationDelay: "2s" }}>
          {activeTheme.decorations[4]}
        </div>
        <div className="absolute top-1/3 right-5 text-3xl md:text-5xl animate-float hidden lg:block" style={{ animationDelay: "1.5s" }}>
          {activeTheme.decorations[5]}
        </div>
      </div>

      {/* Inline styles for animations */}
      <style>{`
        @keyframes float {
          0%, 100% {
            transform: translateY(0px) rotate(0deg);
          }
          50% {
            transform: translateY(-20px) rotate(5deg);
          }
        }
        .animate-float {
          animation: float 3s ease-in-out infinite;
        }
        @keyframes fade-up {
          0% {
            opacity: 0;
            transform: translateY(30px);
          }
          100% {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .animate-fade-up {
          animation: fade-up 1s ease-out;
        }
      `}</style>
    </>
  );
};

export default SeasonalBackground;
