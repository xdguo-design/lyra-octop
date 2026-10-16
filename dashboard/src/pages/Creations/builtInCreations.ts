interface BuiltInCreationBase {
  id: string;
  category: "platform" | "service";
  titleKey: string;
  descriptionKey: string;
  thumb: string;
}

export type BuiltInAppCreation = BuiltInCreationBase & {
  type: "app";
  url: string;
};
export type BuiltInExternalCreation = BuiltInCreationBase & {
  type: "external";
  url: string | null;
};
export type BuiltInCreation = BuiltInAppCreation | BuiltInExternalCreation;

export const PLANET_URL = "http://127.0.0.1:8130/";

export const BUILT_IN_CREATIONS: BuiltInCreation[] = [
  {
    id: "planet",
    type: "app",
    category: "platform",
    titleKey: "creationsPage.builtIn.planet",
    descriptionKey: "creationsPage.builtIn.planetDescription",
    thumb: "/workbench/thumbs/planet.png",
    url: PLANET_URL,
  },
];
