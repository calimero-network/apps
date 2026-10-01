import styled from "styled-components";

const DeletedMessageWrapper = styled.div`
  color: #696969;
  padding: 10px 15px;
  font-style: italic;
  max-width: 80%; /* Maximum width of the message */
  word-wrap: break-word;
  font-size: 14px;
`;

const DeletedMessage = () => (
  <DeletedMessageWrapper>This message has been deleted.</DeletedMessageWrapper>
);

export default DeletedMessage;
