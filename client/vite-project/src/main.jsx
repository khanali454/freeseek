import { createRoot } from 'react-dom/client'
import './index.css'
import { BrowserRouter, Routes, Route } from "react-router";
import FreeSeek from './FreeSeek.jsx';
import Login from './pages/Login.jsx';
import SignUp from './pages/Signup.jsx';

createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <Routes>
      <Route index element={<Login />} />
      <Route path="chats" element={<FreeSeek />} />

      <Route path="login" element={<Login />} />
      <Route path="sign-up" element={<SignUp />} />



    </Routes>

  </BrowserRouter>,
)
