import {
  setAppEndpointKey,
  setContextId,
  setExecutorPublicKey,
  type ResponseData,
} from "@calimero-network/calimero-client";
import { useState } from "react";
import { styled } from "styled-components";
import { ClientApiDataSource } from "../../api/dataSource/clientApiDataSource";
import { extractErrorMessage } from "../../utils/errorParser";
import { defaultActiveChat } from "../../mock/mock";
import { updateSessionChat } from "../../utils/session";

const LoginWrapper = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100vh;
  background: #0e0e10;
  font-family:
    -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
`;

const LoginCard = styled.div`
  background: white;
  padding: 2rem;
  border-radius: 12px;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1);
  width: 100%;
  max-width: 400px;
`;

const Title = styled.h1`
  text-align: center;
  color: #333;
  margin-bottom: 1.5rem;
  font-size: 1.8rem;
  font-weight: 600;
`;

const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: 1rem;
`;

const InputGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
`;

const Label = styled.label`
  font-size: 0.9rem;
  font-weight: 500;
  color: #555;
`;

const Input = styled.input`
  padding: 0.75rem;
  border: 2px solid #e1e5e9;
  border-radius: 6px;
  font-size: 1rem;
  transition: border-color 0.2s ease;

  &:focus {
    outline: none;
    border-color: #667eea;
  }

  &::placeholder {
    color: #999;
  }
`;

const Button = styled.button`
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border: none;
  padding: 0.75rem;
  border-radius: 6px;
  font-size: 1rem;
  font-weight: 500;
  cursor: pointer;
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease;
  margin-top: 1rem;

  &:hover {
    transform: translateY(-1px);
    box-shadow: 0 5px 15px rgba(102, 126, 234, 0.4);
  }

  &:active {
    transform: translateY(0);
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    transform: none;
  }
`;

const ErrorMessage = styled.div`
  color: #e74c3c;
  font-size: 0.9rem;
  text-align: center;
  margin-top: 0.5rem;
`;

const SuccessMessage = styled.div`
  color: #27ae60;
  font-size: 0.9rem;
  text-align: center;
  margin-top: 0.5rem;
`;

export default function Login() {
  const [formData, setFormData] = useState({
    nodeUrl: "",
    contextId: "",
    identityId: "",
  });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
    setError("");
    setSuccess("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");
    setSuccess("");

    // Validate inputs
    if (
      !formData.nodeUrl.trim() ||
      !formData.contextId.trim() ||
      !formData.identityId.trim()
    ) {
      setError("All fields are required");
      setIsLoading(false);
      return;
    }

    try {
      setAppEndpointKey(formData.nodeUrl.trim());
      setContextId(formData.contextId.trim());
      setExecutorPublicKey(formData.identityId.trim());
      const response: ResponseData<string> =
        await new ClientApiDataSource().joinChat();
      if (response.error) {
        const errorMessage = extractErrorMessage(response.error);
        if (errorMessage.includes("Already a member")) {
          setSuccess("Already connected to chat!");
          updateSessionChat(defaultActiveChat);
        } else {
          setError(errorMessage);
          return;
        }
      } else {
        setSuccess("Successfully joined chat!");
        updateSessionChat(defaultActiveChat);
      }

      setTimeout(() => {
        window.location.href = "/";
      }, 1000);
    } catch (_err) {
      setError("Failed to save login information");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <LoginWrapper>
      <LoginCard>
        <Title>Welcome to Curb Chat</Title>
        <Form onSubmit={handleSubmit}>
          <InputGroup>
            <Label htmlFor="nodeUrl">Node URL</Label>
            <Input
              id="nodeUrl"
              name="nodeUrl"
              type="text"
              placeholder="Enter node URL"
              value={formData.nodeUrl}
              onChange={handleInputChange}
              disabled={isLoading}
            />
          </InputGroup>

          <InputGroup>
            <Label htmlFor="contextId">Context ID</Label>
            <Input
              id="contextId"
              name="contextId"
              type="text"
              placeholder="Enter context ID"
              value={formData.contextId}
              onChange={handleInputChange}
              disabled={isLoading}
            />
          </InputGroup>

          <InputGroup>
            <Label htmlFor="identityId">Identity ID</Label>
            <Input
              id="identityId"
              name="identityId"
              type="text"
              placeholder="Enter identity ID"
              value={formData.identityId}
              onChange={handleInputChange}
              disabled={isLoading}
            />
          </InputGroup>

          <Button type="submit" disabled={isLoading}>
            {isLoading ? "Setting up..." : "Connect"}
          </Button>

          {error && <ErrorMessage>{error}</ErrorMessage>}
          {success && <SuccessMessage>{success}</SuccessMessage>}
        </Form>
      </LoginCard>
    </LoginWrapper>
  );
}
