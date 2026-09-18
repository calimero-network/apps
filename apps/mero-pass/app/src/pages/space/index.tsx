import PassNavbar from '../../components/PassNavbar';
import VaultList from './VaultList';

export default function SpacePage() {
  return (
    <>
      <PassNavbar />
      <div className="min-h-screen bg-gray-50">
        <div className="container mx-auto px-4 py-8">
          <div className="max-w-6xl mx-auto">
            <VaultList />
          </div>
        </div>
      </div>
    </>
  );
}
