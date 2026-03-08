import { Composition, registerRoot } from "remotion";
import { LaunchFilmComposition } from "./src/components/animations/LaunchFilmComposition";
import { animationBeats } from "./src/components/animations/launchFilmData";
import "./src/remotion.css";

const durationInFrames = animationBeats[animationBeats.length - 1].endFrame + 1;

export const RemotionRoot: React.FC = () => {
    return (
        <>
            <Composition
                id="LaunchFilm"
                component={LaunchFilmComposition}
                durationInFrames={durationInFrames}
                fps={30}
                width={1920}
                height={1080}
            />
        </>
    );
};

registerRoot(RemotionRoot);
