function Navbar() {
  return (
    <nav className="bg-blue-900 text-white shadow-lg">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">

        {/* Left Section */}
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-full bg-white text-blue-900 flex items-center justify-center font-bold">
            GCE
          </div>

          <div>
            <h1 className="font-bold text-lg">
              Government College of Engineering
            </h1>

            <p className="text-xs text-blue-200">
              Tirunelveli AI Assistant
            </p>
          </div>
        </div>

        {/* Right Section */}
        <div className="flex items-center gap-4">

          <button className="hover:text-blue-200">
            Home
          </button>

          <button className="hover:text-blue-200">
            About
          </button>

          <button className="hover:text-blue-200">
            Help
          </button>

          <button className="bg-white text-blue-900 px-4 py-2 rounded-lg font-semibold hover:bg-blue-100">
            Login
          </button>

        </div>

      </div>
    </nav>
  );
}

export default Navbar;