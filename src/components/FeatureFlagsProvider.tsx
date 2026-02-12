"use client";

import { createContext, useContext } from "react";

type FeatureFlagsContextValue = {
  mobileOfflineMode: boolean;
};

const FeatureFlagsContext = createContext<FeatureFlagsContextValue>({
  mobileOfflineMode: false
});

export function FeatureFlagsProvider({
  mobileOfflineMode,
  children
}: {
  mobileOfflineMode: boolean;
  children: React.ReactNode;
}) {
  return (
    <FeatureFlagsContext.Provider value={{ mobileOfflineMode }}>
      {children}
    </FeatureFlagsContext.Provider>
  );
}

export function useFeatureFlags() {
  return useContext(FeatureFlagsContext);
}
