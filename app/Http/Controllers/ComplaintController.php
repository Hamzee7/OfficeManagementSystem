<?php namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use App\Oms\Complaint\Manager;
use App\Oms\Complaint\Models\Complaint;
use App\Oms\User\Models\User;
use Illuminate\Support\Facades\Session;

class ComplaintController extends AuthController
{

    protected $complaintManager;

    public function __construct(Manager $complaintManager)
    {
        parent::__construct();
        $this->complaintManager = $complaintManager;
    }

    /**
     * Display a listing of the resource.
     *
     * @return Response
     */
    public function index(Request $request)
    {
        $user = $request->user();
        $filters = $request->only(['status', 'priority', 'category', 'search']);

        return view('oms.pages.complaints.index', [
            'complaints' => $this->complaintManager->listFor($user, $filters)->appends($filters),
            'stats' => $this->complaintManager->statsFor($user),
            'filters' => $filters,
        ]);
    }

    /**
     * Show the form for creating a new resource.
     *
     * @return Response
     */
    public function create()
    {
        return view('oms.pages.complaints.create');
    }

    /**
     * Store a newly created resource in storage.
     *
     * @return Response
     */
    public function store(Request $request)
    {
        $complaintDetails = $request->validate([
            'title' => 'required|max:150',
            'complaint' => 'required',
            'category' => ['required', Rule::in(Complaint::CATEGORIES)],
            'priority' => ['required', Rule::in(Complaint::PRIORITIES)],
        ]);
        $this->complaintManager->create($complaintDetails, $request->user());
        Session::flash('notice', 'Successfully reported Complaint');

        return redirect('/complaints');
    }

    /**
     * Display the specified resource.
     *
     * @param  int $id
     * @return Response
     */
    public function show(Request $request, $id)
    {
        $complaint = $this->complaintManager->getDetail($id);
        $this->authorizeView($request->user(), $complaint);

        $admins = $request->user()->designation === User::ADMIN
            ? User::where('designation', User::ADMIN)->get()
            : [];

        return view('oms.pages.complaints.show', compact('complaint', 'admins'));
    }

    /**
     * Admin only: change the status and assignee of a complaint.
     *
     * @param Request $request
     * @param int $id
     * @return Response
     */
    public function update(Request $request, $id)
    {
        $this->authorizeAdmin($request->user());

        $data = $request->validate([
            'status' => ['required', Rule::in(Complaint::STATUSES)],
            'assigned_to' => 'nullable|exists:users,id',
        ]);

        $complaint = $this->complaintManager->find($id);
        $this->complaintManager->updateStatus($complaint, $data['status'], $data['assigned_to'] ?? null);
        Session::flash('notice', 'Complaint updated');

        return redirect('/complaints/' . $complaint->id);
    }

    /**
     * Add a comment to a complaint. Visible to the owner and administrators.
     *
     * @param Request $request
     * @param int $id
     * @return Response
     */
    public function comment(Request $request, $id)
    {
        $complaint = $this->complaintManager->find($id);
        $this->authorizeView($request->user(), $complaint);

        $data = $request->validate(['body' => 'required']);
        $this->complaintManager->addComment($complaint, $request->user(), $data['body']);
        Session::flash('notice', 'Comment added');

        return redirect('/complaints/' . $complaint->id);
    }

    /**
     * Remove the specified resource from storage.
     *
     * @param  int $id
     * @return Response
     */
    public function destroy(Request $request, $id)
    {
        $this->authorizeAdmin($request->user());

        $complaint = $this->complaintManager->find($id);
        $this->complaintManager->delete($complaint);
        Session::flash('notice', 'Successfully deleted Complaint');

        return redirect('/complaints');
    }

    private function authorizeAdmin(User $user)
    {
        abort_unless($user->designation === User::ADMIN, 403);
    }

    private function authorizeView(User $user, Complaint $complaint)
    {
        abort_unless(
            $user->designation === User::ADMIN || $complaint->user_id === $user->id,
            403
        );
    }

}
