import { Link, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center bg-background p-6">
      <div className="w-full max-w-2xl rounded-sm border border-border/55 bg-card px-6 py-10 text-center soft-elevation">
        <p className="mb-2 text-xs uppercase tracking-[0.08em] text-muted-foreground">OrderSounds</p>
        <h1 className="mb-3 font-display text-5xl tracking-[0.04em]">404</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          This route does not exist in the current workspace.
        </p>
        <Button asChild>
          <Link to="/">Return to Overview</Link>
        </Button>
      </div>
    </div>
  );
};

export default NotFound;
