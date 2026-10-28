<?php

namespace App\Oms\Complaint\Models;

use App\Oms\User\Models\User;
use Illuminate\Database\Eloquent\Model;

/**
 * Class ComplaintComment
 * @package App\Oms\Complaint\Models
 */
class ComplaintComment extends Model
{
    /**
     * @var string
     */
    protected $table = 'complaint_comments';

    /**
     * @var array
     */
    protected $fillable = ['body'];

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
    public function complaint()
    {
        return $this->belongsTo(Complaint::class, 'complaint_id');
    }
}
