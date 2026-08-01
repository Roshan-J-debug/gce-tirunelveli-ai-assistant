function Sidebar() {
  return (
    <aside className="w-64 bg-slate-800 text-white h-screen p-4">
      <h2 className="text-2xl font-bold mb-6">
        GCE AI
      </h2>

      <button className="w-full bg-blue-600 hover:bg-blue-700 rounded-lg py-2 mb-6">
        + New Chat
      </button>

      <div>
        <h3 className="text-sm text-gray-300 mb-2">
          Recent Chats
        </h3>

        <ul className="space-y-2">
          <li className="hover:bg-slate-700 rounded p-2 cursor-pointer">
            Admission Process
          </li>

          <li className="hover:bg-slate-700 rounded p-2 cursor-pointer">
            Fee Structure
          </li>

          <li className="hover:bg-slate-700 rounded p-2 cursor-pointer">
            Hostel Information
          </li>
        </ul>
      </div>
    </aside>
  );
}

export default Sidebar;