import React from "react";
import { styled } from "styled-components";
import type { ChatFile, FileObject } from "../types/Common";
import { useState } from "react";

const ButtonUpload = styled.div`
  .custom-files {
    width: 206px;
    padding: 8px 16px; /* 8px top and bottom, 16px left and right */
    color: #fff; /* Text color */
    font-family: "Helvetica Neue"; /* Font family */
    font-size: 16px; /* Font size */
    font-style: normal;
    font-weight: 400;
    line-height: 150%; /* 24px */
    cursor: pointer;
    border-radius: 2px;
    :hover {
      background-color: #686672;
    }
  }
`;

const HiddenFileInput = styled.input`
  display: none;
`;

interface UploadComponentProps {
  uploadedFile: ChatFile | null;
  setUploadedFile: (file: ChatFile | null) => void;
  type: string[];
  icon: React.ReactNode;
  text: string;
  setError: (error: string) => void;
}

declare function asyncFetch(url: string, options: RequestInit): Promise<{ status: number; body: { cid: string } }>;

export default function UploadComponent({
  uploadedFile: _uploadedFile,
  setUploadedFile,
  type: _type,
  icon,
  text,
  setError,
}: UploadComponentProps) {
  const [uploading, setUploading] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const uploadFileUpdateState = (file: globalThis.File) => {
    setError("");
    setUploading(true);
    
    asyncFetch("https://ipfs.near.social/add", {
      method: "POST",
      headers: { Accept: "application/json" },
      body: file as BodyInit,
    }).then((res) => {
      setUploading(false);
      if (res.status === 500) {
        setError("Maximum file size is 10MB!");
        setUploadedFile(null);
      } else {
        setError("");
        const cid = res.body.cid;
        const fileObject: FileObject = {
          cid, 
          name: file.name,
          size: file.size,
          type: file.type
        };
        setUploadedFile({ file: fileObject });
      }
    }).catch((_err) => {
      setUploading(false);
      setError("Upload failed");
      setUploadedFile(null);
    });
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      const file = files[0];
      const fileObject: FileObject = {
        cid: "",
        name: file.name,
        size: file.size,
        type: file.type
      };
      setUploadedFile({ file: fileObject });
      uploadFileUpdateState(file);
    }
  };

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="d-flex justify-center align-items-center mt-2">
      <ButtonUpload onClick={handleClick}>
        <div className="custom-files">
          {icon}
          {uploading ? "Uploading" : text}
        </div>
      </ButtonUpload>
      <HiddenFileInput
        ref={fileInputRef}
        type="file"
        onChange={handleFileChange}
        accept={_type.join(",")}
      />
    </div>
  );
}
