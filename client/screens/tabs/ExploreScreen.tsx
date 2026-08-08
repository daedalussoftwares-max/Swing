import { ScreenPlaceholder } from '@/components/screen-placeholder';

export default function ExploreScreen() {
  return (
    <ScreenPlaceholder
      icon="compass-outline"
      title="Explore"
      subtitle="Pick a city anywhere in the world and send planes from there."
      currentRoute="/explore"
    />
  );
}
