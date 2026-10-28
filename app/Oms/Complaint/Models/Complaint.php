<?php

namespace App\Oms\Complaint\Models;


use App\Oms\User\Models\User;
use Illuminate\Database\Eloquent\Model;

/**
 * Class Complaint
 * @package App\Oms\Complaint\Models
 */
class Complaint extends Model
{
    const STATUS_OPEN = 'Open';
    const STATUS_IN_PROGRESS = 'In Progress';
    const STATUS_RESOLVED = 'Resolved';
    const STATUS_CLOSED = 'Closed';
    const STATUSES = [
        self::STATUS_OPEN,
        self::STATUS_IN_PROGRESS,
        self::STATUS_RESOLVED,
        self::STATUS_CLOSED,
    ];

    const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];

    const CATEGORIES = [
        'Workplace',
        'Harassment',
        'Salary & Benefits',
        'Facilities',
        'IT & Equipment',
        'Management',
        'Other',
    ];

    /**
     * @var string
     */
    protected $table = 'complaints';

    /**
     * @var array
     */
    protected $fillable = ['title', 'complaint', 'category', 'priority'];

    /**
     * @var array
     */
    protected $dates = ['created_at', 'updated_at', 'resolved_at'];

    /**
     * @return \Illuminate\Database\Eloquent\Relations\BelongsTo
     */
    public function user()
    {
        return $this->belongsTo(User::class, 'user_id');
    }

    /**
     * @return \Illuminate\Database\Eloquent\Relations\BelongsTo
     */
    public function assignee()
    {
        return $this->belongsTo(User::class, 'assigned_to');
    }

    /**
     * @return \Illuminate\Database\Eloquent\Relations\HasMany
     */
    public function comments()
    {
        return $this->hasMany(ComplaintComment::class, 'complaint_id');
    }

    /**
     * @param User $user
     * @return Model
     */
    public function associateUser(User $user)
    {
        return $this->user()->associate($user);
    }

    /**
     * @return bool
     */
    public function isOpen()
    {
        return !in_array($this->status, [self::STATUS_RESOLVED, self::STATUS_CLOSED], true);
    }

    /**
     * Bootstrap 3 label class for the status badge.
     *
     * @return string
     */
    public function statusClass()
    {
        return [
            self::STATUS_OPEN => 'label-danger',
            self::STATUS_IN_PROGRESS => 'label-warning',
            self::STATUS_RESOLVED => 'label-success',
            self::STATUS_CLOSED => 'label-default',
        ][$this->status] ?? 'label-default';
    }

    /**
     * Bootstrap 3 label class for the priority badge.
     *
     * @return string
     */
    public function priorityClass()
    {
        return [
            'Low' => 'label-info',
            'Medium' => 'label-primary',
            'High' => 'label-warning',
            'Urgent' => 'label-danger',
        ][$this->priority] ?? 'label-default';
    }
}
