import React, { useState } from 'react';
import { AbiClient, SecretItem } from '../api/AbiClient';
import {
  Modal,
  Button,
  Input,
  Text,
  Textarea,
  Select,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Alert,
} from '@calimero-network/mero-ui';

interface SecretFormProps {
  api: AbiClient;
  vaultId: string;
  memberPublicKey: string;
  secret?: SecretItem;
  onSuccess: () => void;
  trigger?: React.ReactNode;
}

interface LoginData {
  username: string;
  password: string;
  url: string;
  notes?: string;
}

interface TotpData {
  secret: string;
  issuer: string;
  account: string;
}

interface SshKeyData {
  private_key: string;
  public_key: string;
  passphrase?: string;
}

interface PaymentCardData {
  card_number: string;
  expiry_date: string;
  cvv: string;
  cardholder_name: string;
  notes?: string;
}

interface SecureNoteData {
  content: string;
  notes?: string;
}

const SecretForm: React.FC<SecretFormProps> = ({
  api,
  vaultId,
  memberPublicKey,
  secret,
  onSuccess,
  trigger
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Form state
  const [name, setName] = useState(secret?.name || '');
  const [secretType, setSecretType] = useState(secret?.secret_type || 'login');
  const [tags, setTags] = useState(secret?.tags.join(', ') || '');
  
  // Type-specific data
  const [loginData, setLoginData] = useState<LoginData>(() => {
    if (secret?.secret_type === 'login' && secret.data) {
      try {
        return JSON.parse(secret.data);
      } catch {
        return { username: '', password: '', url: '', notes: '' };
      }
    }
    return { username: '', password: '', url: '', notes: '' };
  });

  const [totpData, setTotpData] = useState<TotpData>(() => {
    if (secret?.secret_type === 'totp' && secret.data) {
      try {
        return JSON.parse(secret.data);
      } catch {
        return { secret: '', issuer: '', account: '' };
      }
    }
    return { secret: '', issuer: '', account: '' };
  });

  const [sshKeyData, setSshKeyData] = useState<SshKeyData>(() => {
    if (secret?.secret_type === 'ssh_key' && secret.data) {
      try {
        return JSON.parse(secret.data);
      } catch {
        return { private_key: '', public_key: '', passphrase: '' };
      }
    }
    return { private_key: '', public_key: '', passphrase: '' };
  });

  const [paymentCardData, setPaymentCardData] = useState<PaymentCardData>(() => {
    if (secret?.secret_type === 'payment_card' && secret.data) {
      try {
        return JSON.parse(secret.data);
      } catch {
        return { card_number: '', expiry_date: '', cvv: '', cardholder_name: '', notes: '' };
      }
    }
    return { card_number: '', expiry_date: '', cvv: '', cardholder_name: '', notes: '' };
  });

  const [secureNoteData, setSecureNoteData] = useState<SecureNoteData>(() => {
    if (secret?.secret_type === 'secure_note' && secret.data) {
      try {
        return JSON.parse(secret.data);
      } catch {
        return { content: '', notes: '' };
      }
    }
    return { content: '', notes: '' };
  });

  const getSecretData = (): string => {
    switch (secretType) {
      case 'login':
        return JSON.stringify(loginData);
      case 'totp':
        return JSON.stringify(totpData);
      case 'ssh_key':
        return JSON.stringify(sshKeyData);
      case 'payment_card':
        return JSON.stringify(paymentCardData);
      case 'secure_note':
        return JSON.stringify(secureNoteData);
      default:
        return '';
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Name is required');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const secretData = getSecretData();
      const tagsArray = tags.split(',').map(tag => tag.trim()).filter(tag => tag);

      if (secret) {
        // Update existing secret
        await api.updateSecret({
          vault_id: vaultId,
          secret_id: secret.id,
          name,
          data: secretData,
          tags: tagsArray,
          member_public_key: memberPublicKey
        });
      } else {
        // Create new secret
        await api.addSecret({
          vault_id: vaultId,
          name,
          secret_type: secretType,
          data: secretData,
          tags: tagsArray,
          member_public_key: memberPublicKey
        });
      }

      onSuccess();
      setIsOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save secret');
    } finally {
      setIsLoading(false);
    }
  };

  const renderTypeSpecificFields = () => {
    switch (secretType) {
      case 'login':
        return (
          <div className="space-y-4">
            <div>
              <label htmlFor="username" className="block text-sm font-medium mb-1">Username</label>
              <Input
                id="username"
                value={loginData.username}
                onChange={(e) => setLoginData(prev => ({ ...prev, username: e.target.value }))}
                placeholder="Enter username"
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-sm font-medium mb-1">Password</label>
              <Input
                id="password"
                type="password"
                value={loginData.password}
                onChange={(e) => setLoginData(prev => ({ ...prev, password: e.target.value }))}
                placeholder="Enter password"
              />
            </div>
            <div>
              <label htmlFor="url" className="block text-sm font-medium mb-1">URL</label>
              <Input
                id="url"
                value={loginData.url}
                onChange={(e) => setLoginData(prev => ({ ...prev, url: e.target.value }))}
                placeholder="https://example.com"
              />
            </div>
            <div>
              <label htmlFor="login-notes" className="block text-sm font-medium mb-1">Notes</label>
              <Textarea
                id="login-notes"
                value={loginData.notes || ''}
                onChange={(e) => setLoginData(prev => ({ ...prev, notes: e.target.value }))}
                placeholder="Additional notes"
              />
            </div>
          </div>
        );

      case 'totp':
        return (
          <div className="space-y-4">
            <div>
              <label htmlFor="secret" className="block text-sm font-medium mb-1">Secret Key</label>
              <Input
                id="secret"
                value={totpData.secret}
                onChange={(e) => setTotpData(prev => ({ ...prev, secret: e.target.value }))}
                placeholder="Enter TOTP secret"
              />
            </div>
            <div>
              <label htmlFor="issuer" className="block text-sm font-medium mb-1">Issuer</label>
              <Input
                id="issuer"
                value={totpData.issuer}
                onChange={(e) => setTotpData(prev => ({ ...prev, issuer: e.target.value }))}
                placeholder="e.g., Google, GitHub"
              />
            </div>
            <div>
              <label htmlFor="account" className="block text-sm font-medium mb-1">Account</label>
              <Input
                id="account"
                value={totpData.account}
                onChange={(e) => setTotpData(prev => ({ ...prev, account: e.target.value }))}
                placeholder="user@example.com"
              />
            </div>
          </div>
        );

      case 'ssh_key':
        return (
          <div className="space-y-4">
            <div>
              <label htmlFor="private-key" className="block text-sm font-medium mb-1">Private Key</label>
              <Textarea
                id="private-key"
                value={sshKeyData.private_key}
                onChange={(e) => setSshKeyData(prev => ({ ...prev, private_key: e.target.value }))}
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                rows={6}
              />
            </div>
            <div>
              <label htmlFor="public-key" className="block text-sm font-medium mb-1">Public Key</label>
              <Textarea
                id="public-key"
                value={sshKeyData.public_key}
                onChange={(e) => setSshKeyData(prev => ({ ...prev, public_key: e.target.value }))}
                placeholder="ssh-rsa AAAAB3NzaC1yc2E..."
                rows={3}
              />
            </div>
            <div>
              <label htmlFor="passphrase" className="block text-sm font-medium mb-1">Passphrase (optional)</label>
              <Input
                id="passphrase"
                type="password"
                value={sshKeyData.passphrase || ''}
                onChange={(e) => setSshKeyData(prev => ({ ...prev, passphrase: e.target.value }))}
                placeholder="Enter passphrase"
              />
            </div>
          </div>
        );

      case 'payment_card':
        return (
          <div className="space-y-4">
            <div>
              <label htmlFor="card-number" className="block text-sm font-medium mb-1">Card Number</label>
              <Input
                id="card-number"
                value={paymentCardData.card_number}
                onChange={(e) => setPaymentCardData(prev => ({ ...prev, card_number: e.target.value }))}
                placeholder="1234 5678 9012 3456"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="expiry" className="block text-sm font-medium mb-1">Expiry Date</label>
                <Input
                  id="expiry"
                  value={paymentCardData.expiry_date}
                  onChange={(e) => setPaymentCardData(prev => ({ ...prev, expiry_date: e.target.value }))}
                  placeholder="MM/YY"
                />
              </div>
              <div>
                <label htmlFor="cvv" className="block text-sm font-medium mb-1">CVV</label>
                <Input
                  id="cvv"
                  value={paymentCardData.cvv}
                  onChange={(e) => setPaymentCardData(prev => ({ ...prev, cvv: e.target.value }))}
                  placeholder="123"
                />
              </div>
            </div>
            <div>
              <label htmlFor="cardholder" className="block text-sm font-medium mb-1">Cardholder Name</label>
              <Input
                id="cardholder"
                value={paymentCardData.cardholder_name}
                onChange={(e) => setPaymentCardData(prev => ({ ...prev, cardholder_name: e.target.value }))}
                placeholder="John Doe"
              />
            </div>
            <div>
              <label htmlFor="card-notes" className="block text-sm font-medium mb-1">Notes</label>
              <Textarea
                id="card-notes"
                value={paymentCardData.notes || ''}
                onChange={(e) => setPaymentCardData(prev => ({ ...prev, notes: e.target.value }))}
                placeholder="Additional notes"
              />
            </div>
          </div>
        );

      case 'secure_note':
        return (
          <div className="space-y-4">
            <div>
              <label htmlFor="content" className="block text-sm font-medium mb-1">Content</label>
              <Textarea
                id="content"
                value={secureNoteData.content}
                onChange={(e) => setSecureNoteData(prev => ({ ...prev, content: e.target.value }))}
                placeholder="Enter your secure note"
                rows={6}
              />
            </div>
            <div>
              <label htmlFor="note-notes" className="block text-sm font-medium mb-1">Notes</label>
              <Textarea
                id="note-notes"
                value={secureNoteData.notes || ''}
                onChange={(e) => setSecureNoteData(prev => ({ ...prev, notes: e.target.value }))}
                placeholder="Additional notes"
              />
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <>
      {trigger || (
        <Button onClick={() => setIsOpen(true)}>
          {secret ? 'Edit Secret' : 'Add Secret'}
        </Button>
      )}
      
      <Modal 
        open={isOpen} 
        onClose={() => setIsOpen(false)}
        title={secret ? 'Edit Secret' : 'Add New Secret'}
        className="max-w-2xl max-h-[90vh] overflow-y-auto"
      >
        
        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <Alert>
              {error}
            </Alert>
          )}

          <div className="space-y-4">
            <div>
              <label htmlFor="name" className="block text-sm font-medium mb-1">Name *</label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter secret name"
                required
              />
            </div>

            <div>
              <label htmlFor="type" className="block text-sm font-medium mb-1">Type</label>
              <Select 
                value={secretType} 
                onChange={setSecretType}
                options={[
                  { value: "login", label: "🔐 Login" },
                  { value: "secure_note", label: "📝 Secure Note" },
                  { value: "totp", label: "⏰ TOTP" },
                  { value: "ssh_key", label: "🔑 SSH Key" },
                  { value: "payment_card", label: "💳 Payment Card" }
                ]}
                placeholder="Select secret type"
              />
            </div>

            <div>
              <label htmlFor="tags" className="block text-sm font-medium mb-1">Tags</label>
              <Input
                id="tags"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="Enter tags separated by commas"
              />
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Secret Data</CardTitle>
            </CardHeader>
            <CardContent>
              {renderTypeSpecificFields()}
            </CardContent>
          </Card>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outlined"
              onClick={() => setIsOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? 'Saving...' : (secret ? 'Update' : 'Create')}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
};

export default SecretForm;
