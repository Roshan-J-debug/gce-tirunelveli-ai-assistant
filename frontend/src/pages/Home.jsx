import MainLayout from "../layouts/MainLayout";
import ChatWindow from "../components/ChatWindow";
import ChatInput from "../components/ChatInput";

function Home() {
  return (
    <MainLayout>
      <div className="space-y-8">

        {/* Hero Section */}
        <section className="text-center py-10">

          <h1 className="text-5xl font-bold text-slate-800">
            Welcome to
          </h1>

          <h2 className="mt-3 text-4xl font-bold text-blue-700">
            GCE Tirunelveli AI Assistant
          </h2>

          <p className="mt-6 max-w-3xl mx-auto text-gray-600 text-lg">
            Your intelligent assistant for admissions, academics,
            departments, hostel facilities, placements, scholarships,
            regulations, and official college information.
          </p>

        </section>

        {/* Quick Actions */}

        <section>

          <h3 className="text-xl font-semibold mb-5">
            Popular Questions
          </h3>

          <div className="grid md:grid-cols-3 gap-5">

            <button className="bg-white rounded-xl shadow p-5 hover:shadow-lg transition">
              🎓 Admissions
            </button>

            <button className="bg-white rounded-xl shadow p-5 hover:shadow-lg transition">
              🏫 Departments
            </button>

            <button className="bg-white rounded-xl shadow p-5 hover:shadow-lg transition">
              🛏 Hostel
            </button>

            <button className="bg-white rounded-xl shadow p-5 hover:shadow-lg transition">
              💰 Fee Structure
            </button>

            <button className="bg-white rounded-xl shadow p-5 hover:shadow-lg transition">
              💼 Placements
            </button>

            <button className="bg-white rounded-xl shadow p-5 hover:shadow-lg transition">
              📚 Academic Regulations
            </button>

          </div>

        </section>

        {/* Chat Section */}

        <section className="bg-white rounded-xl shadow-lg p-6">

          <ChatWindow />

          <div className="mt-6">
            <ChatInput />
          </div>

        </section>

      </div>
    </MainLayout>
  );
}

export default Home;