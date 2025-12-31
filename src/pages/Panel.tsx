const Panel = () => {
  return (
    <div className="min-h-screen pt-24 pb-0">
      <div className="container mx-auto px-4 mb-4">
        <h1 className="text-2xl font-bold text-gradient">Game Panel</h1>
        <p className="text-muted-foreground">Manage your game servers</p>
      </div>
      <div className="w-full h-[calc(100vh-140px)]">
        <iframe
          src="https://panel.kesor.cam/"
          className="w-full h-full border-0 rounded-lg"
          title="Game Panel"
          allow="fullscreen"
        />
      </div>
    </div>
  );
};

export default Panel;
