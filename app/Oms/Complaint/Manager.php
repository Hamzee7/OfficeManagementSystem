<?php

namespace App\Oms\Complaint;

use App\Oms\Complaint\Exceptions\ComplaintNotFoundException;
use App\Oms\Complaint\Models\Complaint;
use App\Oms\Complaint\Models\ComplaintComment;
use App\Oms\User\Models\User;

/**
 * Class Manager
 * @package App\Oms\Complaint
 */
class Manager
{
    /**
     * @var Complaint
     */
    private $complaint;

    /**
     * Manager constructor.
     * @param Complaint $complaint
     */
    public function __construct(Complaint $complaint)
    {
        $this->complaint = $complaint;
    }

    /**
     * @param $id
     * @return mixed
     */
    public function find($id)
    {
        $complaint = $this->complaint->find($id);
        throw_if(!$complaint, new ComplaintNotFoundException());
        return $complaint;
    }

    /**
     * @param $id
     * @return Complaint
     */
    public function getDetail($id)
    {
        $complaint = $this->complaint
            ->with(['user', 'assignee', 'comments.user'])
            ->find($id);
        throw_if(!$complaint, new ComplaintNotFoundException());
        return $complaint;
    }

    /**
     * List complaints. Employees only ever see their own.
     *
     * @param User $viewer
     * @param array $filters status, priority, category, search
     * @return \Illuminate\Contracts\Pagination\LengthAwarePaginator
     */
    public function listFor(User $viewer, array $filters = [])
    {
        $query = $this->complaint->with(['user', 'assignee']);

        if ($viewer->designation !== User::ADMIN) {
            $query->where('user_id', $viewer->id);
        }

        foreach (['status', 'priority', 'category'] as $field) {
            if (!empty($filters[$field])) {
                $query->where($field, $filters[$field]);
            }
        }

        if (!empty($filters['search'])) {
            $term = '%' . $filters['search'] . '%';
            $query->where(function ($q) use ($term) {
                $q->where('title', 'like', $term)->orWhere('complaint', 'like', $term);
            });
        }

        return $query->orderBy('created_at', 'desc')->paginate(15);
    }

    /**
     * Counts per status, scoped to what the viewer may see.
     *
     * @param User $viewer
     * @return array
     */
    public function statsFor(User $viewer)
    {
        $query = $this->complaint->newQuery();

        if ($viewer->designation !== User::ADMIN) {
            $query->where('user_id', $viewer->id);
        }

        $counts = $query->selectRaw('status, count(*) as total')
            ->groupBy('status')
            ->pluck('total', 'status')
            ->all();

        $stats = [];
        foreach (Complaint::STATUSES as $status) {
            $stats[$status] = isset($counts[$status]) ? (int)$counts[$status] : 0;
        }
        $stats['Total'] = array_sum($stats);

        return $stats;
    }

    /**
     * @param array $complaintDetails
     * @param User $user
     * @return bool
     */
    public function create(array $complaintDetails, User $user)
    {
        $complaint = $this->complaint->newInstance();
        $complaint->fill($complaintDetails);
        $complaint->status = Complaint::STATUS_OPEN;

        return $complaint->associateUser($user)->save();
    }

    /**
     * Admin action: change status and/or assignee.
     *
     * @param Complaint $complaint
     * @param string $status
     * @param int|null $assignedTo
     * @return bool
     */
    public function updateStatus(Complaint $complaint, $status, $assignedTo = null)
    {
        $complaint->status = $status;
        $complaint->assigned_to = $assignedTo ?: null;
        $complaint->resolved_at = $complaint->isOpen() ? null : ($complaint->resolved_at ?: now());

        return $complaint->save();
    }

    /**
     * @param Complaint $complaint
     * @param User $author
     * @param string $body
     * @return ComplaintComment
     */
    public function addComment(Complaint $complaint, User $author, $body)
    {
        $comment = new ComplaintComment(['body' => $body]);
        $comment->user()->associate($author);

        return $complaint->comments()->save($comment);
    }

    /**
     * @param Complaint $complaint
     * @return bool|null
     */
    public function delete(Complaint $complaint)
    {
        return $complaint->delete();
    }
}
